import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { encodeFunctionData, getAddress, type Address, type Hex, type PublicClient } from "viem";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { BlastRadius, Blob, Id16 } from "@tyrell/core";
import { llmFromEnv, signRequest } from "@tyrell/core";
import { laneRegistryAbi, readLedger, type Deployment } from "@tyrell/chain";
import { call, type SeedSpecMsg } from "@tyrell/ipc";
import { anchorDomain } from "@tyrell/control";
import { IngestWorker, LlmJudge, type Incident, type McpReader } from "@tyrell/ingest";
import { encryptKeystore, keystoreAddress, newSecret, writeKeystore } from "@tyrell/storage";
import { account, checkKeyIsolation, clients, deployment, home, passphrase, paths, readConfig } from "./config.js";
import type { OwnerTx } from "./setup.js";

// ------------------------------------------------------------------ ingest

class McpBalances implements McpReader {
  private client?: Client;
  constructor(private readonly url = process.env.QIE_MCP_URL ?? "https://mcp.qie.digital/mcp", private readonly network: string) {}
  async balances(address: Address): Promise<string> {
    if (!this.client) {
      this.client = new Client({ name: "tyrell-ingest", version: "0.1.0" });
      await this.client.connect(new StreamableHTTPClientTransport(new URL(this.url)));
    }
    const r = await this.client.callTool({ name: "qie_get_balances", arguments: { address, network: this.network, include_tokens: true } });
    return (r.content as Array<{ type: string; text?: string }>).map((x) => x.text ?? "").join("\n");
  }
  async close() {
    await this.client?.close();
  }
}

const stateFile = () => join(home(), "ingest-state.json");

/**
 * The AI sentinel, when a model is configured: SENTINEL_LLM_* or, failing that, the agent's LLM_*
 * (FORTYTWO_API_KEY alone selects Fortytwo's Qwen).
 * A separate model is better (the attacker then has to fool two), but either works because the judge
 * can only raise alarms. SENTINEL_AI=off disables it.
 */
export function sentinelJudge(env: NodeJS.ProcessEnv = process.env): LlmJudge | undefined {
  if ((env.SENTINEL_AI ?? "auto") === "off") return undefined;
  const cfg = llmFromEnv(env, "judge");
  if (!cfg) return undefined;
  const { baseURL, apiKey, model, reasoningEffort } = cfg;
  return new LlmJudge({ baseURL, apiKey, model, ...(reasoningEffort ? { reasoningEffort } : {}), timeoutMs: Number(env.SENTINEL_AI_TIMEOUT_MS ?? 15_000) });
}

/** The ingest worker process: wallet key only (I-12). */
export function ingestWorker(o: { mcp?: boolean } = {}): { worker: IngestWorker; pub: PublicClient; d: Deployment; close: () => Promise<void> | undefined } {
  checkKeyIsolation("ingest");
  const c = readConfig();
  const d = deployment(c);
  const pub = clients(c)[0]!;
  const blocklistPath = process.env.TYRELL_BLOCKLIST ?? join(home(), "blocklist.json");
  const blocklist = new Set<string>(existsSync(blocklistPath) ? (JSON.parse(readFileSync(blocklistPath, "utf8")) as string[]).map((a) => a.toLowerCase()) : []);
  const mcp = o.mcp && c.network !== "local" ? new McpBalances(undefined, c.network) : undefined;
  const judge = sentinelJudge();
  const walletKey = account("ingest", "wallet");
  // Requests that make control act are signed with the wallet lane key (S-6).
  const signed = <T extends Record<string, unknown>>(req: T) => signRequest(walletKey, d.acct, req);
  const worker = new IngestWorker({
    client: pub,
    watch: [d.guardedVault, ...(process.env.TYRELL_WATCH ? process.env.TYRELL_WATCH.split(",").map((a) => getAddress(a.trim())) : [])],
    walletKey,
    acct: d.acct,
    domain: anchorDomain(d),
    control: {
      submitBatch: async (blobs: Blob[]) => (await call(paths().socket, { type: "submitBatch", blobs: blobs as never })) as Array<{ id: Id16 }>,
      incident: async (i: Incident) => call(paths().socket, await signed({ type: "incident", incident: i as unknown as Record<string, unknown> })),
      quarantineSource: async (ref: Address, reason: string) => call(paths().socket, await signed({ type: "quarantine", seed: { type: "source", ref }, reason })),
    },
    known: async () => (await readLedger(pub, d, await pub.getBlockNumber({ cacheTime: 0 }))).payees.map((p) => p.addr),
    blocklist,
    threshold: Number(process.env.SENTINEL_THRESHOLD ?? 60),
    dust: BigInt(process.env.SENTINEL_DUST ?? 1000),
    autoQuarantineBlocklist: (process.env.AUTO_QUARANTINE_BLOCKLIST ?? "true") === "true",
    ...(mcp ? { mcp } : {}),
    ...(judge ? { judge } : {}),
  });
  return { worker, pub, d, close: () => mcp?.close() };
}

/**
 * `tyrell ingest scan`: one sentinel pass from the last scanned block (or --from) to head, one window
 * at a time. The cursor advances after each window that was written and scored, so a failure (control
 * down, an RPC error) costs at most one window of retries and never pins the sentinel to old blocks.
 * Hostile events inside a window are handled by the worker itself (B-2).
 */
export async function ingestScan(o: { from?: bigint; mcp?: boolean } = {}) {
  const { worker, pub, d, close } = ingestWorker(o);
  try {
    const state = existsSync(stateFile()) ? (JSON.parse(readFileSync(stateFile(), "utf8")) as { last: string }) : undefined;
    const from = o.from ?? (state ? BigInt(state.last) + 1n : d.startBlock);
    const to = await pub.getBlockNumber({ cacheTime: 0 });
    if (from > to) return { from: from.toString(), to: to.toString(), observations: [], incidents: [] };
    const w = BigInt(process.env.SENTINEL_WINDOW ?? 5_000);
    const observations: Id16[] = [];
    const found: Incident[] = [];
    for (let s = from; s <= to; s += w) {
      const e = s + w - 1n < to ? s + w - 1n : to;
      const r = await worker.scan(s, e);
      observations.push(...r.observations);
      found.push(...r.incidents);
      writeFileSync(stateFile(), JSON.stringify({ last: e.toString() }) + "\n");
    }
    return { from: from.toString(), to: to.toString(), observations, incidents: found };
  } finally {
    await close();
  }
}

// ------------------------------------------------------------------ quarantine and blast radius

export function parseSeed(o: { source?: string; memory?: string; signerWindow?: string; turn?: string }): SeedSpecMsg {
  const given = [o.source, o.memory, o.signerWindow, o.turn].filter(Boolean).length;
  if (given !== 1) throw new Error("pass exactly one of --source, --memory, --signer-window, --turn");
  if (o.source) return { type: "source", ref: o.source };
  if (o.memory) return { type: "memory", id: o.memory.toLowerCase() };
  if (o.turn) return { type: "turn", turn: o.turn.toLowerCase() };
  const m = /^(0x[0-9a-fA-F]{40}):(\d+)-(\d+)$/.exec(o.signerWindow!);
  if (!m) throw new Error("--signer-window <address>:<fromBlock>-<toBlock>");
  return { type: "signer-window", signer: m[1]!, fromBlock: m[2]!, toBlock: m[3]! };
}

/** `tyrell quarantine`: preview, confirm, then seed with the control key (FR-14). */
export async function quarantineCmd(seed: SeedSpecMsg, reason: string, yes: boolean, log: (s: string) => void = (s) => console.error(s)) {
  const pv = (await call(paths().socket, { type: "quarantine", seed, reason, preview: true })) as { memories: number; decisions: number; vaultTxs: number; payeesSuspended: Hex[] };
  log(`Preview: ${pv.memories} memories, ${pv.decisions} decisions, ${pv.vaultTxs} vault transactions${pv.payeesSuspended.length ? `, suspends ${pv.payeesSuspended.length} payee(s)` : ""}`);
  if (!yes) {
    if (!process.stdin.isTTY) throw new Error("not a terminal: pass --yes to confirm");
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const a = await rl.question("Seed this quarantine on-chain? [y/N] ");
    rl.close();
    if (a.trim().toLowerCase() !== "y") throw new Error("cancelled");
  }
  // Seeding is signed with the user key: only the user (or the sentinel's automatic blocklist seed)
  // may make control quarantine (S-6).
  checkKeyIsolation("cli");
  const d = deployment(readConfig());
  return call(paths().socket, await signRequest(account("cli", "user"), d.acct, { type: "quarantine", seed, reason }));
}

/** Blast radius as a Mermaid graph (the static fallback for the web view, spec section 18 cut order). */
export function mermaid(b: BlastRadius): string {
  const id = (s: string) => `n${s.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
  const esc = (s: string) => s.replace(/["\n]/g, " ").slice(0, 60);
  const lines = ["graph LR"];
  for (const n of b.nodes) {
    const text = n.type === "source" ? esc(n.label) : `${n.type === "decision" ? "decision" : `lane ${n.lane}`} ${n.cls}${n.quarantined ? " Q" : ""}: ${esc(n.label)}`;
    lines.push(n.type === "source" ? `  ${id(n.id)}[/"${text}"/]` : n.type === "decision" ? `  ${id(n.id)}{{"${text}"}}` : `  ${id(n.id)}["${text}"]`);
  }
  for (const e of b.edges) lines.push(`  ${id(e.from)} --> ${id(e.to)}`);
  return lines.join("\n");
}

export const blast = (seedId: number) => call(paths().socket, { type: "blast", seedId }) as Promise<BlastRadius>;
export const incidents = () => call(paths().socket, { type: "incidents" });

// ------------------------------------------------------------------ revoke and rotate

const LANE_OF: Record<string, number> = { user: 1, agent: 2, wallet: 3, control: 4 };

/**
 * The owner transaction that revokes a lane key, or rotates it to a freshly generated key written to
 * keys/<role>.next.json (FR-15). Revocation is independent of quarantine (I-9).
 */
export async function revokeTxs(c: PublicClient, d: Deployment, role: string, rotate: boolean, reason: string): Promise<{ txs: OwnerTx[]; oldKey: Address; newKey?: Address }> {
  const lane = LANE_OF[role];
  if (!lane) throw new Error("--lane user | agent | wallet | control");
  const oldKey = await c.readContract({ address: d.laneRegistry, abi: laneRegistryAbi, functionName: "activeKey", args: [lane] });
  if (oldKey === "0x0000000000000000000000000000000000000000") throw new Error(`lane ${role} has no active key`);
  if (!rotate) {
    return { oldKey, txs: [{ label: `Revoke the ${role} lane key ${oldKey}`, to: d.laneRegistry, data: encodeFunctionData({ abi: laneRegistryAbi, functionName: "revokeLaneKey", args: [oldKey, reason] }) }] };
  }
  const next = join(paths().keys, `${role}.next.json`);
  if (!existsSync(next)) writeKeystore(next, encryptKeystore(newSecret(), passphrase(role), { role, evm: true, ...(process.env.TYRELL_SCRYPT_N ? { n: Number(process.env.TYRELL_SCRYPT_N) } : {}) }));
  const newKey = keystoreAddress(next);
  return {
    oldKey,
    newKey,
    txs: [{ label: `Rotate the ${role} lane key ${oldKey} -> ${newKey}`, to: d.laneRegistry, data: encodeFunctionData({ abi: laneRegistryAbi, functionName: "rotateLaneKey", args: [oldKey, newKey, reason] }) }],
  };
}

/** After the rotation is on-chain: retire the old key file and make the new one current. */
export async function finishRotation(c: PublicClient, d: Deployment, role: string, newKey: Address): Promise<void> {
  const active = await c.readContract({ address: d.laneRegistry, abi: laneRegistryAbi, functionName: "activeKey", args: [LANE_OF[role]!] });
  if (active.toLowerCase() !== newKey.toLowerCase()) throw new Error(`lane ${role} is not yet on ${newKey}`);
  const retired = join(paths().keys, "retired");
  mkdirSync(retired, { recursive: true, mode: 0o700 });
  renameSync(paths().key(role as never), join(retired, `${role}-${Date.now()}.json`));
  renameSync(join(paths().keys, `${role}.next.json`), paths().key(role as never));
  const addrs = JSON.parse(readFileSync(paths().addresses, "utf8")) as Record<string, Address>;
  addrs[role] = newKey;
  writeFileSync(paths().addresses, JSON.stringify(addrs, null, 2) + "\n");
}
