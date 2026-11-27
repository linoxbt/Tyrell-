import {
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  recoverTypedDataAddress,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { Blob, Lane, memoryTypedData, toMemoryStruct, type AnchorRecord, type Id16 } from "@tyrell/core";
import { memoryAnchorAbi, laneRegistryAbi, qieMainnet, qieTestnet, readSnapshot, tyrellLedgerAbi, type Deployment } from "@tyrell/chain";
import { sealBlob, type BlobStore, type DataKey, type ProjectionDb } from "@tyrell/storage";
import { anchorDomain, buildProjection, recallRows, storeFetcher, type BuiltProjection } from "./projection.js";

export function chainFor(chainId: number, rpc: string): Chain {
  if (chainId === qieMainnet.id) return qieMainnet;
  if (chainId === qieTestnet.id) return qieTestnet;
  return defineChain({ id: chainId, name: `local-${chainId}`, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
}

export interface ControlOptions {
  deployment: Deployment;
  /** At least two, for the cross-check. */
  clients: PublicClient[];
  /** Pays gas for anchors: the only key MemoryAnchor accepts as submitter. */
  submitter: Account;
  rpc: string;
  dataKey: DataKey;
  store: BlobStore;
  db: ProjectionDb;
  confirmations?: bigint;
  window?: bigint;
}

export interface Anchored {
  id: Id16;
  cid: string;
  txHash: Hex;
  block: bigint;
}

export class SubmitRejected extends Error {}

/** How far ahead of control's head a lane process's refBlock may be (different RPC endpoints). */
export const REF_BLOCK_SKEW = 2n;

/**
 * Tyrell control (spec section 4): verifies, encrypts, pins and anchors envelopes signed by lane
 * processes, keeps the local cache, and computes the projection. It holds the control, submitter
 * and data keys, never the owner key or the vault signer key.
 */
export class Control {
  private readonly wallet: WalletClient;
  private queue: Promise<unknown> = Promise.resolve();
  private last?: BuiltProjection;

  constructor(private readonly o: ControlOptions) {
    this.wallet = createWalletClient({ account: o.submitter, chain: chainFor(o.deployment.chainId, o.rpc), transport: http(o.rpc) });
  }

  private get reader(): PublicClient {
    return this.o.clients[0]!;
  }

  /** Startup rule: exactly one active key per lane, or refuse to start (spec section 5). */
  async start(): Promise<BuiltProjection> {
    const p = await this.refresh();
    p.keys.assertOneActiveKeyPerLane();
    return p;
  }

  /** Accepts one signed envelope, as the write path in spec section 6 describes. */
  submit(raw: unknown): Promise<Anchored> {
    return this.serial(async () => (await this.anchorMany([raw]))[0]!);
  }

  /** Up to 20 envelopes in one anchorBatch transaction. */
  submitBatch(raws: unknown[]): Promise<Anchored[]> {
    return this.serial(() => this.anchorMany(raws));
  }

  private serial<T>(f: () => Promise<T>): Promise<T> {
    const run = this.queue.then(f, f);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async anchorMany(raws: unknown[]): Promise<Anchored[]> {
    if (raws.length === 0 || raws.length > 20) throw new SubmitRejected("between 1 and 20 envelopes per batch");
    // Uncached: a cached head can lag the lane process's view of the chain.
    const head = await this.reader.getBlockNumber({ cacheTime: 0 });
    const prepared = [];
    for (const raw of raws) {
      // 1-2. Parse and verify the signature and lane binding off-chain first (fail fast).
      const parsed = Blob.safeParse(raw);
      if (!parsed.success) throw new SubmitRejected(`malformed envelope: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      const { header, body, signature } = parsed.data;
      if (header.acct !== this.o.deployment.acct.toLowerCase()) throw new SubmitRejected("wrong account");
      // Endpoints can be a block or two apart; MemoryAnchor enforces refBlock <= block.number exactly.
      if (BigInt(header.refBlock) > head + REF_BLOCK_SKEW) throw new SubmitRejected("refBlock is in the future");
      const struct = toMemoryStruct(header, body);
      if (struct.bodyLen !== header.bodyLen || Buffer.byteLength(body, "utf8") !== header.bodyLen) throw new SubmitRejected("bodyLen does not match body");
      const signer = await recoverTypedDataAddress({ ...memoryTypedData(struct, anchorDomain(this.o.deployment)), signature: signature as Hex });
      const active = await this.reader.readContract({
        address: this.o.deployment.laneRegistry,
        abi: laneRegistryAbi,
        functionName: "isActiveFor",
        args: [signer, header.lane],
      });
      if (!active) throw new SubmitRejected(`signer ${signer} is not the active ${Object.keys(Lane)[header.lane - 1]?.toLowerCase()} key`);
      // 3. Encrypt and pin.
      const sealed = await sealBlob(this.o.dataKey, this.o.deployment.acct, header.id, parsed.data);
      const cid = await this.o.store.put(sealed);
      prepared.push({ struct, signature: signature as Hex, cid, blob: parsed.data });
    }

    // 4. Anchor. MemoryAnchor re-checks the signature and lane on-chain (I-1).
    const txHash =
      prepared.length === 1
        ? await this.wallet.writeContract({
            address: this.o.deployment.memoryAnchor,
            abi: memoryAnchorAbi,
            functionName: "anchor",
            args: [prepared[0]!.struct, prepared[0]!.signature, prepared[0]!.cid],
            chain: this.wallet.chain,
            account: this.o.submitter,
          })
        : await this.wallet.writeContract({
            address: this.o.deployment.memoryAnchor,
            abi: memoryAnchorAbi,
            functionName: "anchorBatch",
            args: [prepared.map((p) => p.struct), prepared.map((p) => p.signature), prepared.map((p) => p.cid)],
            chain: this.wallet.chain,
            account: this.o.submitter,
          });

    // 5. Wait for the receipt, then index.
    const receipt = await this.reader.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
    if (receipt.status !== "success") throw new SubmitRejected(`anchor transaction ${txHash} reverted`);
    const logs = parseEventLogs({ abi: memoryAnchorAbi, eventName: "MemoryAnchored", logs: receipt.logs });
    return prepared.map((p) => {
      const log = logs.find((l) => l.args.id.toLowerCase() === p.struct.id);
      if (!log) throw new SubmitRejected(`no MemoryAnchored event for ${p.struct.id}`);
      const a: AnchorRecord = {
        id: p.struct.id,
        lane: log.args.lane,
        signer: log.args.signer,
        ns: log.args.ns,
        structHash: log.args.structHash,
        parentsHash: log.args.parentsHash,
        bodyHash: log.args.bodyHash,
        cid: log.args.cid,
        refBlock: log.args.refBlock,
        pos: { block: log.blockNumber, logIndex: log.logIndex },
      };
      this.o.db.putAnchor({
        id: a.id,
        lane: a.lane,
        signer: a.signer.toLowerCase(),
        ns: a.ns,
        structHash: a.structHash,
        parentsHash: a.parentsHash,
        bodyHash: a.bodyHash,
        cid: a.cid,
        refBlock: a.refBlock.toString(),
        block: a.pos.block.toString(),
        logIndex: a.pos.logIndex,
      });
      this.o.db.putBlob(a.id, p.blob);
      return { id: a.id, cid: p.cid, txHash, block: receipt.blockNumber };
    });
  }

  /**
   * Re-reads chain state at a head, re-verifies, recomputes classes and quarantine, and replaces the
   * recall index. Blobs come from the local cache when present, else from the store.
   */
  async refresh(head?: bigint): Promise<BuiltProjection> {
    const snap = await readSnapshot(this.o.clients, this.o.deployment, {
      ...(head !== undefined ? { head } : {}),
      confirmations: this.o.confirmations ?? 0n,
      ...(this.o.window !== undefined ? { window: this.o.window } : {}),
    });
    const fromStore = storeFetcher(this.o.store, this.o.dataKey, this.o.deployment.acct);
    const built = await buildProjection(snap, this.o.deployment, async (a) => {
      const cached = this.o.db.blob(a.id);
      return cached !== undefined ? { ok: true, blob: cached } : fromStore(a);
    });
    this.o.db.setVisible(recallRows(built.projection));
    this.o.db.setMeta("head", built.head.toString());
    this.o.db.setMeta("digest", built.digest);
    this.last = built;
    return built;
  }

  get projection(): BuiltProjection | undefined {
    return this.last;
  }

  get deployment(): Deployment {
    return this.o.deployment;
  }

  /**
   * Relays a user-signed ledger action (payee add/remove/reinstate, quarantine release) as a
   * transaction paid by the submitter. Control adds nothing: TyrellLedger checks the user-lane
   * signature, nonce and deadline itself (I-11), so a relayed message can only do what the user signed.
   */
  relayLedger(action: "AddPayee" | "RemovePayee" | "ReinstatePayee" | "ReleaseQuarantine", m: Record<string, unknown>, signature: Hex): Promise<{ txHash: Hex; block: bigint }> {
    return this.serial(async () => {
      const big = (k: string) => BigInt(m[k] as string | number | bigint);
      const common = { address: this.o.deployment.tyrellLedger, abi: tyrellLedgerAbi, chain: this.wallet.chain, account: this.o.submitter } as const;
      let hash: Hex;
      switch (action) {
        case "AddPayee":
          hash = await this.wallet.writeContract({
            ...common,
            functionName: "addPayee",
            args: [
              { addr: m.addr as Hex, token: m.token as Hex, capPerTx: big("capPerTx"), capPerDay: big("capPerDay"), label: m.label as string, active: false, suspended: false },
              m.payeeId as Hex,
              big("nonce"),
              big("deadline"),
              signature,
            ],
          });
          break;
        case "RemovePayee":
          hash = await this.wallet.writeContract({ ...common, functionName: "removePayee", args: [m.payeeId as Hex, big("nonce"), big("deadline"), signature] });
          break;
        case "ReinstatePayee":
          hash = await this.wallet.writeContract({ ...common, functionName: "reinstatePayee", args: [m.payeeId as Hex, big("nonce"), big("deadline"), signature] });
          break;
        case "ReleaseQuarantine":
          hash = await this.wallet.writeContract({ ...common, functionName: "releaseQuarantine", args: [big("seedId"), m.reasonCid as string, big("nonce"), big("deadline"), signature] });
          break;
      }
      const r = await this.reader.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new SubmitRejected(`ledger transaction ${hash} reverted`);
      return { txHash: hash, block: r.blockNumber };
    });
  }
}
