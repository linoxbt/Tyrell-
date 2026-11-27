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

export class ChainInconsistent extends Error {}

/** Fingerprint of everything read in [from, head], to compare endpoints cheaply. */
function fingerprint(s: Omit<ChainSnapshot, "headHash">, from: bigint): Hex {
  const inWindow = (p: { block: bigint }) => p.block >= from;
  return keccak256(
    toBytes(
      canonicalJson({
        lanes: s.laneEvents.filter((e) => inWindow(e.pos)).map((e) => [e.kind, e.lane, e.key.toLowerCase(), e.pos.block.toString(), e.pos.logIndex]),
        anchors: s.anchors.filter((a) => inWindow(a.pos)).map((a) => [a.id, a.structHash.toLowerCase(), a.cid, a.pos.block.toString(), a.pos.logIndex]),
        payees: s.ledger.payees.map((p) => [p.payeeId, p.addr.toLowerCase(), p.token.toLowerCase(), String(p.capPerTx), String(p.capPerDay), p.active, p.suspended]),
        seeds: s.ledger.seeds.map((x) => [x.seedId, x.type, x.value, String(x.fromBlock), String(x.toBlock), x.released]),
      }),
    ),
  );
}

/**
 * Reads everything a projection needs at one head, from the first client, then cross-checks the
 * head hash, the final window of events and the full ledger state on a second client (spec
 * section 11). Throws ChainInconsistent if they disagree.
 */
export async function readSnapshot(
  clients: readonly PublicClient[],
  d: Deployment,
  o: ReadOptions & { head?: bigint; confirmations?: bigint } = {},
): Promise<ChainSnapshot> {
  if (clients.length < 2) throw new ChainInconsistent("need two RPC endpoints to cross-check");
  const [a, b] = clients as [PublicClient, PublicClient];
  // Uncached: viem caches getBlockNumber, and a stale head would silently drop the newest events.
  const head = o.head ?? (await a.getBlockNumber({ cacheTime: 0 })) - (o.confirmations ?? 2n);
  const read = async (c: PublicClient) => {
    const [laneEvents, anchors, ledger] = await Promise.all([readLaneEvents(c, d, head, o), readAnchors(c, d, head, o), readLedger(c, d, head, o)]);
    return { head, laneEvents, anchors, ledger };
  };
  const [blockA, blockB] = await Promise.all([a.getBlock({ blockNumber: head }), b.getBlock({ blockNumber: head })]);
  if (blockA.hash !== blockB.hash) throw new ChainInconsistent(`endpoints disagree on block ${head}`);
  const full = await read(a);
  const window = o.window ?? 5_000n;
  const from = head >= window ? head - window + 1n : 0n;
  const check = await read(b);
  if (fingerprint(full, from) !== fingerprint(check, from)) throw new ChainInconsistent(`endpoints disagree on state in blocks ${from}-${head}`);
  return { ...full, headHash: blockA.hash! };
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
