import { decodeAbiParameters, getAddress, keccak256, pad, toBytes, type Address, type Hex, type Log, type PublicClient } from "viem";
import type { LocalAccount } from "viem/accounts";
import { Kind, Lane, signEnvelope, sourceSeedValue, type AnchorDomain, type Blob, type Id16, type SrcRef } from "@tyrell/core";
import { TRANSFER_TOPIC0 } from "@tyrell/chain";
import { erc20Meta, fetchMetadata, metadataText, nftUri, type FetchMetaOptions } from "./metadata.js";
import { looksAlike, score, type ScoreContext } from "./score.js";

const TRANSFER_SINGLE = keccak256(toBytes("TransferSingle(address,address,address,uint256,uint256)"));
const TRANSFER_BATCH = keccak256(toBytes("TransferBatch(address,address,address,uint256[],uint256[])"));

export interface Incident {
  memoryId: Id16;
  source: Address;
  score: number;
  rules: string[];
  proposedSeed: { type: "source"; value: Hex; ref: Address };
  block: string;
  summary: string;
}

/** What the ingest worker may ask of control: anchor its observations, record incidents. */
export interface IngestControl {
  submitBatch(blobs: Blob[]): Promise<Array<{ id: Id16 }>>;
  incident(i: Incident): Promise<unknown>;
  /** Auto-quarantine for blocklist hits (exclusion is reversible, so this is allowed: spec section 10). */
  quarantineSource?(source: Address, reason: string): Promise<unknown>;
}

export interface McpReader {
  balances(address: Address): Promise<string>;
}

export interface IngestOptions {
  client: PublicClient;
  /** Addresses to watch: Steward's vault and any address the agent is known by. */
  watch: Address[];
  /** The wallet lane key: the only key the ingest worker holds (I-12). */
  walletKey: LocalAccount;
  acct: Hex;
  domain: AnchorDomain;
  control: IngestControl;
  /** Payees and other known counterparties, for look-alike checks. */
  known: () => Promise<Address[]>;
  blocklist?: Set<string>;
  threshold?: number;
  /** Transfers at or below this amount count as dust. */
  dust?: bigint;
  autoQuarantineBlocklist?: boolean;
  mcp?: McpReader;
  fetch?: FetchMetaOptions;
  window?: bigint;
}

interface Observation {
  body: string;
  src: SrcRef[];
  texts: string[];
  addresses: Address[];
  amount?: bigint;
  source: Address;
}

const topicAddr = (t: Hex | undefined): Address => getAddress(`0x${(t ?? "0x").slice(-40)}`);

/**
 * The ingest worker (spec section 10, sentinel). External data reaches the model only as a memory:
 * every transfer, token name, NFT description and MCP result is written through the wallet lane
 * *before* anything else sees it, then scored. Detection proposes; it never blocks Steward.
 */
export class IngestWorker {
  constructor(private readonly o: IngestOptions) {}

  private async logs(from: bigint, to: bigint): Promise<Log[]> {
    const c = this.o.client;
    const w = this.o.window ?? 5_000n;
    const out: Log[] = [];
    for (let s = from; s <= to; s += w) {
      const e = s + w - 1n < to ? s + w - 1n : to;
      for (const a of this.o.watch) {
        const t = pad(a.toLowerCase() as Hex);
        const queries: Array<(Hex | null)[]> = [
          [TRANSFER_TOPIC0, null, t], // ERC-20 / ERC-721 in
          [TRANSFER_TOPIC0, t], // out (zero-value transferFrom poisoning shows up here)
          [TRANSFER_SINGLE, null, null, t],
          [TRANSFER_BATCH, null, null, t],
        ];
        for (const topics of queries) {
          out.push(...(await c.request({ method: "eth_getLogs", params: [{ fromBlock: `0x${s.toString(16)}`, toBlock: `0x${e.toString(16)}`, topics }] })).map(normaliseLog));
        }
      }
    }
    const seen = new Set<string>();
    return out
      .filter((l) => {
        const k = `${l.transactionHash}:${l.logIndex}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (a.blockNumber! < b.blockNumber! ? -1 : a.blockNumber! > b.blockNumber! ? 1 : a.logIndex! - b.logIndex!));
  }

  private async observe(l: Log, watched: Set<string>): Promise<Observation | undefined> {
    const token = getAddress(l.address);
    const tx = l.transactionHash!;
    const topics = l.topics as Hex[];
    if (topics[0] === TRANSFER_TOPIC0) {
      const from = topicAddr(topics[1]);
      const to = topicAddr(topics[2]);
      const incoming = watched.has(to.toLowerCase());
      if (topics.length === 4) {
        const id = BigInt(topics[3]!);
        const uri = await nftUri(this.o.client, token, id, "erc721");
        const meta = uri ? await fetchMetadata(uri, this.o.fetch) : { ok: false as const, error: "no tokenURI" };
        const texts = meta.ok ? metadataText(meta.text) : [];
        return {
          body: `${incoming ? "Incoming" : "Outgoing"} NFT ${token} #${id} from ${from} to ${to} (tx ${tx}). Metadata: ${meta.ok ? texts.join(" | ") : `unavailable (${meta.error})`}`,
          src: [{ t: "nft", addr: token, tokenId: id.toString(), tx, from }],
          texts,
          addresses: [token, from, to],
          source: token,
        };
      }
      const amount = l.data && l.data !== "0x" ? (decodeAbiParameters([{ type: "uint256" }], l.data)[0] as bigint) : 0n;
      if (!incoming && amount > (this.o.dust ?? 0n)) return undefined; // ordinary outgoing payment
      const meta = await erc20Meta(this.o.client, token);
      const texts = [meta.name, meta.symbol].filter((x): x is string => !!x);
      return {
        body: `${incoming ? "Incoming" : "Outgoing"} ERC-20 transfer of ${amount} base units of token ${token} (name "${meta.name ?? "?"}", symbol "${meta.symbol ?? "?"}") from ${from} to ${to} (tx ${tx})`,
        src: [{ t: "transfer", addr: token, tx, from }],
        texts,
        addresses: [token, from, to],
        amount,
        source: token,
      };
    }
    // ERC-1155: decode ids from data; one observation for the event.
    const from = topicAddr(topics[2]);
    const to = topicAddr(topics[3]);
    let ids: bigint[] = [];
    try {
      ids = topics[0] === TRANSFER_SINGLE ? [decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], l.data)[0]] : [...decodeAbiParameters([{ type: "uint256[]" }, { type: "uint256[]" }], l.data)[0]];
    } catch {
      ids = [];
    }
    const texts: string[] = [];
    for (const id of ids.slice(0, 3)) {
      const uri = await nftUri(this.o.client, token, id, "erc1155");
      const meta = uri ? await fetchMetadata(uri, this.o.fetch) : undefined;
      if (meta?.ok) texts.push(...metadataText(meta.text));
    }
    return {
      body: `Incoming ERC-1155 ${token} ids [${ids.join(", ")}] from ${from} to ${to} (tx ${tx}). Metadata: ${texts.join(" | ") || "none"}`,
      src: [{ t: "nft", addr: token, tokenId: (ids[0] ?? 0n).toString(), tx, from }],
      texts,
      addresses: [token, from, to],
      source: token,
    };
  }

  /** One sentinel pass over [from, to]. Returns what was written and the incidents raised. */
  async scan(from: bigint, to: bigint): Promise<{ observations: Id16[]; incidents: Incident[] }> {
    const watched = new Set(this.o.watch.map((a) => a.toLowerCase()));
    const obs: Observation[] = [];
    for (const l of await this.logs(from, to)) {
      const o = await this.observe(l, watched);
      if (o) obs.push(o);
    }
    if (this.o.mcp) {
      for (const a of this.o.watch) {
        try {
          const text = await this.o.mcp.balances(a);
          obs.push({ body: `QIE MCP qie_get_balances(${a}): ${text.slice(0, 4000)}`, src: [{ t: "mcp", tool: "qie_get_balances", args: { address: a } }], texts: [], addresses: [], source: a });
        } catch {
          /* MCP down: ingest falls back to RPC only (spec section 20) */
        }
      }
    }
    if (obs.length === 0) return { observations: [], incidents: [] };

    // 1. Write everything through the wallet lane first.
    const refBlock = to;
    const blobs = await Promise.all(
      obs.map((o) => signEnvelope(this.o.walletKey, this.o.domain, { acct: this.o.acct, lane: Lane.Wallet, kind: Kind.Observation, body: o.body.slice(0, 8000), refBlock, src: o.src })),
    );
    const ids: Id16[] = [];
    for (let i = 0; i < blobs.length; i += 20) ids.push(...(await this.o.control.submitBatch(blobs.slice(i, i + 20))).map((r) => r.id));

    // 2. Then score.
    const known = [...(await this.o.known()), ...this.o.watch];
    const ctx: ScoreContext = { blocklist: this.o.blocklist ?? new Set(), known };
    const incidents: Incident[] = [];
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i]!;
      const s = score({ texts: o.texts, addresses: o.addresses, ...(o.amount !== undefined ? { amount: o.amount } : {}), dust: this.o.dust ?? 0n }, ctx);
      if (s.score < (this.o.threshold ?? 60)) continue;
      // For address poisoning, the source to quarantine is the look-alike address, not the token.
      const lookalike = s.rules.includes("lookalike") ? o.addresses.find((a) => known.some((k) => looksAlike(a, k))) : undefined;
      const ref = lookalike ?? o.source;
      const inc: Incident = { memoryId: ids[i]!, source: ref, score: s.score, rules: s.rules, proposedSeed: { type: "source", value: sourceSeedValue(ref), ref }, block: to.toString(), summary: o.body.slice(0, 240) };
      incidents.push(inc);
      await this.o.control.incident(inc);
      if (s.rules.includes("blocklist") && this.o.autoQuarantineBlocklist && this.o.control.quarantineSource) {
        await this.o.control.quarantineSource(ref, `auto: blocklist hit (${s.rules.join(", ")})`);
      }
    }
    return { observations: ids, incidents };
  }
}

function normaliseLog(l: unknown): Log {
  const x = l as Record<string, unknown>;
  return {
    ...(x as object),
    blockNumber: BigInt(x.blockNumber as string),
    logIndex: Number(x.logIndex as string),
    transactionIndex: Number(x.transactionIndex as string),
  } as Log;
}
