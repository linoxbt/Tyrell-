import { createPublicClient, http, keccak256, toBytes, type Address, type Chain, type Hex, type PublicClient } from "viem";
import type { AnchorRecord, Id16, LaneKeyEvent, PayeeRecord, Seed, SeedType } from "@tyrell/core";
import { canonicalJson } from "@tyrell/core";
import { laneRegistryAbi, memoryAnchorAbi, tyrellLedgerAbi } from "./abi.js";

/** Addresses written by the deploy script (contracts/deployments/<chainId>.json). */
export interface Deployment {
  chainId: number;
  startBlock: bigint;
  acct: Hex;
  owner: Address;
  laneRegistry: Address;
  memoryAnchor: Address;
  tyrellLedger: Address;
  guardedVault: Address;
  token: Address;
  /** Agents network (shared per chain, optional): phase A registry and phase B network. */
  agentRegistry?: Address;
  agentNetwork?: Address;
  /** The QIE ID record store the registry verifies names against. */
  qieId?: Address;
  /** This deployment's agent in the registry: its agent-lane key is the registered agent key. */
  agentId?: bigint;
}

export interface ReadOptions {
  /** eth_getLogs window; probe P-2 found 5,000 safe on QIE. */
  window?: bigint;
}

/** One public client per endpoint, so reads can be compared (R0, NFR-05). */
export function clientsFor(chain: Chain, rpcs: readonly string[]): PublicClient[] {
  return rpcs.map((url) => createPublicClient({ chain, transport: http(url, { retryCount: 2, timeout: 15_000 }) }));
}

type EventName<T> = T extends readonly (infer E)[] ? (E extends { type: "event"; name: infer N } ? N : never) : never;

/** getContractEvents over [from, to] in fixed windows. */
async function eventsPaged<const A extends readonly unknown[]>(
  client: PublicClient,
  address: Address,
  abi: A,
  eventName: EventName<A>,
  from: bigint,
  to: bigint,
  window: bigint,
) {
  const out = [];
  for (let start = from; start <= to; start += window) {
    const end = start + window - 1n < to ? start + window - 1n : to;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logs = await client.getContractEvents({ address, abi: abi as any, eventName: eventName as any, fromBlock: start, toBlock: end, strict: true });
    out.push(...logs);
  }
  return out as unknown as Array<{ args: Record<string, unknown>; blockNumber: bigint; logIndex: number; transactionHash: Hex }>;
}

const pos = (l: { blockNumber: bigint; logIndex: number }) => ({ block: l.blockNumber, logIndex: l.logIndex });

export async function readLaneEvents(c: PublicClient, d: Deployment, head: bigint, o: ReadOptions = {}): Promise<LaneKeyEvent[]> {
  const w = o.window ?? 5_000n;
  const [added, revoked] = await Promise.all([
    eventsPaged(c, d.laneRegistry, laneRegistryAbi, "LaneKeyAdded", d.startBlock, head, w),
    eventsPaged(c, d.laneRegistry, laneRegistryAbi, "LaneKeyRevoked", d.startBlock, head, w),
  ]);
  return [
    ...added.map((l) => ({ kind: "added" as const, lane: Number(l.args.lane), key: l.args.key as Address, pos: pos(l) })),
    ...revoked.map((l) => ({ kind: "revoked" as const, lane: Number(l.args.lane), key: l.args.key as Address, pos: pos(l) })),
  ];
}

export async function readAnchors(c: PublicClient, d: Deployment, head: bigint, o: ReadOptions = {}): Promise<AnchorRecord[]> {
  const logs = await eventsPaged(c, d.memoryAnchor, memoryAnchorAbi, "MemoryAnchored", d.startBlock, head, o.window ?? 5_000n);
  return logs.map((l) => ({
    id: (l.args.id as string).toLowerCase() as Id16,
    lane: Number(l.args.lane),
    signer: l.args.signer as Address,
    ns: l.args.ns as Hex,
    structHash: l.args.structHash as Hex,
    parentsHash: l.args.parentsHash as Hex,
    bodyHash: l.args.bodyHash as Hex,
    cid: l.args.cid as string,
    refBlock: l.args.refBlock as bigint,
    pos: pos(l),
  }));
}

export interface LedgerSnapshot {
  payees: PayeeRecord[];
  seeds: Seed[];
}

/** Payees and seeds as contract state at `head` (I-11): ids from events, values from storage. */
export async function readLedger(c: PublicClient, d: Deployment, head: bigint, o: ReadOptions = {}): Promise<LedgerSnapshot> {
  const w = o.window ?? 5_000n;
  const [added, seeded] = await Promise.all([
    eventsPaged(c, d.tyrellLedger, tyrellLedgerAbi, "PayeeAdded", d.startBlock, head, w),
    eventsPaged(c, d.tyrellLedger, tyrellLedgerAbi, "QuarantineSeeded", d.startBlock, head, w),
  ]);
  const payeeIds = [...new Set(added.map((l) => l.args.payeeId as Hex))];
  const payees = await Promise.all(
    payeeIds.map(async (payeeId) => {
      const p = await c.readContract({ address: d.tyrellLedger, abi: tyrellLedgerAbi, functionName: "payee", args: [payeeId], blockNumber: head });
      return {
        payeeId,
        addr: p.addr,
        token: p.token,
        capPerTx: p.capPerTx,
        capPerDay: p.capPerDay,
        label: p.label,
        active: p.active,
        suspended: p.suspended,
      } satisfies PayeeRecord;
    }),
  );
  const seeds = await Promise.all(
    seeded.map(async (l) => {
      const seedId = l.args.seedId as bigint;
      const s = await c.readContract({ address: d.tyrellLedger, abi: tyrellLedgerAbi, functionName: "seed", args: [seedId], blockNumber: head });
      return {
        seedId: Number(seedId),
        type: s.seedType as SeedType,
        value: s.value,
        fromBlock: s.fromBlock,
        toBlock: s.toBlock,
        released: s.released,
      } satisfies Seed;
    }),
  );
  return { payees, seeds };
}

export interface ChainSnapshot {
  head: bigint;
  headHash: Hex;
  laneEvents: LaneKeyEvent[];
  anchors: AnchorRecord[];
  ledger: LedgerSnapshot;
}

/** The endpoints disagree (or cannot be compared). `code` is what the policy engine reports. */
export class ChainInconsistent extends Error {
  readonly code = "CHAIN_INCONSISTENT" as const;
}

/**
 * Fingerprint of everything read: every field of every lane event and anchor in the range, and the
 * full ledger state. Endpoints are compared on all of it, so a lying endpoint cannot add, drop or
 * alter a single field anywhere in history (S-4).
 */
function fingerprint(s: { laneEvents: LaneKeyEvent[]; anchors: AnchorRecord[]; ledger: LedgerSnapshot }): Hex {
  const lanes = s.laneEvents
    .map((e) => [e.kind, e.lane, e.key.toLowerCase(), e.pos.block.toString(), e.pos.logIndex] as const)
    .sort((x, y) => (x[3] === y[3] ? x[4] - y[4] : BigInt(x[3]) < BigInt(y[3]) ? -1 : 1));
  return keccak256(
    toBytes(
      canonicalJson({
        lanes,
        anchors: s.anchors.map((a) => [
          a.id,
          a.lane,
          a.signer.toLowerCase(),
          a.ns.toLowerCase(),
          a.structHash.toLowerCase(),
          a.parentsHash.toLowerCase(),
          a.bodyHash.toLowerCase(),
          a.cid,
          a.refBlock.toString(),
          a.pos.block.toString(),
          a.pos.logIndex,
        ]),
        payees: s.ledger.payees.map((p) => [p.payeeId.toLowerCase(), p.addr.toLowerCase(), p.token.toLowerCase(), String(p.capPerTx), String(p.capPerDay), p.label, p.active, p.suspended]),
        seeds: s.ledger.seeds.map((x) => [x.seedId, x.type, x.value.toLowerCase(), String(x.fromBlock), String(x.toBlock), x.released]),
      }),
    ),
  );
}

export interface SnapshotOptions extends ReadOptions {
  head?: bigint;
  confirmations?: bigint;
  /**
   * A snapshot this process already read and cross-checked. If its head block is still canonical on
   * the endpoints, only the events after it are read (perf); the ledger state is always re-read in
   * full at the new head.
   */
  since?: ChainSnapshot;
}

/** Ledger state at `head`: payee and seed ids from events (new ones from `from`), values from storage. */
async function readLedgerFrom(c: PublicClient, d: Deployment, head: bigint, from: bigint, prev: LedgerSnapshot | undefined, w: bigint): Promise<LedgerSnapshot> {
  if (!prev) return readLedger(c, d, head, { window: w });
  const [added, seeded] = await Promise.all([
    eventsPaged(c, d.tyrellLedger, tyrellLedgerAbi, "PayeeAdded", from, head, w),
    eventsPaged(c, d.tyrellLedger, tyrellLedgerAbi, "QuarantineSeeded", from, head, w),
  ]);
  const payeeIds = [...new Set([...prev.payees.map((p) => p.payeeId), ...added.map((l) => l.args.payeeId as Hex)])];
  const seedIds = [...new Set([...prev.seeds.map((x) => BigInt(x.seedId)), ...seeded.map((l) => l.args.seedId as bigint)])];
  const payees = await Promise.all(
    payeeIds.map(async (payeeId) => {
      const p = await c.readContract({ address: d.tyrellLedger, abi: tyrellLedgerAbi, functionName: "payee", args: [payeeId], blockNumber: head });
      return { payeeId, addr: p.addr, token: p.token, capPerTx: p.capPerTx, capPerDay: p.capPerDay, label: p.label, active: p.active, suspended: p.suspended } satisfies PayeeRecord;
    }),
  );
  const seeds = await Promise.all(
    seedIds.map(async (seedId) => {
      const x = await c.readContract({ address: d.tyrellLedger, abi: tyrellLedgerAbi, functionName: "seed", args: [seedId], blockNumber: head });
      return { seedId: Number(seedId), type: x.seedType as SeedType, value: x.value, fromBlock: x.fromBlock, toBlock: x.toBlock, released: x.released } satisfies Seed;
    }),
  );
  return { payees, seeds };
}

/**
 * Reads everything a projection needs at one head and cross-checks it (spec section 11, R0, NFR-05):
 *  - the head block hash must match on the first two endpoints, before and after the reads (a reorg
 *    mid-read is refused, so the events belong to that exact chain);
 *  - every lane event, every anchor (all fields) and the full ledger state must match.
 * On disagreement a third endpoint, if configured, decides: the snapshot two endpoints agree on wins.
 * Otherwise it throws ChainInconsistent (code CHAIN_INCONSISTENT).
 * With `since`, history up to since.head is reused (it was cross-checked when read) after both
 * endpoints confirm that block is still canonical; only the new range is read and compared.
 */
export async function readSnapshot(clients: readonly PublicClient[], d: Deployment, o: SnapshotOptions = {}): Promise<ChainSnapshot> {
  if (clients.length < 2) throw new ChainInconsistent("need two RPC endpoints to cross-check");
  const [a] = clients as [PublicClient];
  const w = o.window ?? 5_000n;
  // Uncached: viem caches getBlockNumber, and a stale head would silently drop the newest events.
  const head = o.head ?? (await a.getBlockNumber({ cacheTime: 0 })) - (o.confirmations ?? 2n);

  const read = async (c: PublicClient) => {
    const hashAt = async (n: bigint) => (await c.getBlock({ blockNumber: n })).hash!;
    const headHash = await hashAt(head);
    // Reuse the cross-checked prefix only if its last block is still on this endpoint's chain.
    const since = o.since && o.since.head <= head && (await hashAt(o.since.head).catch(() => undefined)) === o.since.headHash ? o.since : undefined;
    const from = since ? since.head + 1n : d.startBlock;
    const [lanesNew, anchorsNew, ledger] = await Promise.all([
      from <= head ? readLaneEventsFrom(c, d, from, head, w) : Promise.resolve([] as LaneKeyEvent[]),
      from <= head ? readAnchorsFrom(c, d, from, head, w) : Promise.resolve([] as AnchorRecord[]),
      readLedgerFrom(c, d, head, from, since?.ledger, w),
    ]);
    if ((await hashAt(head)) !== headHash) throw new ChainInconsistent(`block ${head} changed while reading (reorg)`);
    const delta = { laneEvents: lanesNew, anchors: anchorsNew, ledger };
    const snap: ChainSnapshot = {
      head,
      headHash,
      laneEvents: [...(since?.laneEvents ?? []), ...lanesNew],
      anchors: [...(since?.anchors ?? []), ...anchorsNew],
      ledger,
    };
    return { snap, key: `${headHash}:${since ? since.headHash : "full"}:${fingerprint(delta)}` };
  };

  const [x, y] = await Promise.all([read(clients[0]!), read(clients[1]!)]);
  if (x.key === y.key) return x.snap;
  // Disagreement: a third endpoint breaks the tie (M-4).
  const third = clients[2];
  if (third) {
    const z = await read(third).catch(() => undefined);
    if (z && z.key === x.key) return x.snap;
    if (z && z.key === y.key) return y.snap;
  }
  throw new ChainInconsistent(x.snap.headHash !== y.snap.headHash ? `endpoints disagree on block ${head}` : `endpoints disagree on chain state up to block ${head}`);
}

async function readLaneEventsFrom(c: PublicClient, d: Deployment, from: bigint, head: bigint, w: bigint): Promise<LaneKeyEvent[]> {
  return readLaneEvents(c, { ...d, startBlock: from }, head, { window: w });
}

async function readAnchorsFrom(c: PublicClient, d: Deployment, from: bigint, head: bigint, w: bigint): Promise<AnchorRecord[]> {
  return readAnchors(c, { ...d, startBlock: from }, head, { window: w });
}

/** Parses contracts/deployments/<chainId>.json. */
export function parseDeployment(json: string): Deployment {
  const v = JSON.parse(json) as Record<string, unknown>;
  return {
    chainId: Number(v.chainId),
    startBlock: BigInt(v.startBlock as number),
    acct: v.acct as Hex,
    owner: v.owner as Address,
    laneRegistry: v.laneRegistry as Address,
    memoryAnchor: v.memoryAnchor as Address,
    tyrellLedger: v.tyrellLedger as Address,
    guardedVault: v.guardedVault as Address,
    token: v.token as Address,
    ...(v.agentRegistry ? { agentRegistry: v.agentRegistry as Address } : {}),
    ...(v.agentNetwork ? { agentNetwork: v.agentNetwork as Address } : {}),
    ...(v.qieId ? { qieId: v.qieId as Address } : {}),
    ...(v.agentId !== undefined && v.agentId !== null ? { agentId: BigInt(v.agentId as string | number) } : {}),
  };
}
