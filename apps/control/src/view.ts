import type { Hex } from "viem";
import { Kind, LANE_NAMES, type Lane } from "@tyrell/core";
import type { BuiltProjection } from "./projection.js";

/** One memory as the web view shows it. Bodies of excluded memories are kept, marked, for forensics. */
export interface ViewMemory {
  id: string;
  lane: number;
  laneName: string;
  kind: number;
  cls: string;
  clsReason: string;
  quarantined: boolean;
  seeds: number[];
  parents: string[];
  signer?: string;
  block?: string;
  logIndex?: number;
  cid?: string;
  verification: string;
  body?: string;
  src: unknown[];
  ts?: string;
}

export interface ViewDecision {
  id: string;
  turn?: string;
  verdict?: { decision: string; code: string; reasons: string[] };
  proposal?: Record<string, unknown>;
  txHash?: string;
  parents: string[];
}

/** Everything the web view needs, in one JSON document (also the read-only snapshot for the demo). */
export interface ViewDocument {
  v: 1;
  generatedAt: string;
  network: string;
  chainId: number;
  head: string;
  digest: Hex;
  contracts: Record<string, string>;
  explorer?: string;
  token?: { address: string; decimals: number; symbol: string };
  memories: ViewMemory[];
  decisions: ViewDecision[];
  seeds: Array<{ seedId: number; type: number; value: string; fromBlock: string; toBlock: string; released: boolean }>;
  payees: Array<{ payeeId: string; label: string; addr: string; token: string; capPerTx: string; capPerDay: string; active: boolean; suspended: boolean }>;
  incidents: unknown[];
}

export function viewDocument(
  p: BuiltProjection,
  o: { network: string; chainId: number; contracts: Record<string, string>; explorer?: string; token?: { address: string; decimals: number; symbol: string }; incidents: unknown[] },
): ViewDocument {
  const byId = new Map(p.results.map((r) => [r.id, r]));
  const memories: ViewMemory[] = [...p.projection.values()].map((m) => {
    const r = byId.get(m.id);
    return {
      id: m.id,
      lane: m.lane ?? 0,
      laneName: LANE_NAMES[(m.lane ?? 0) as Lane] ?? "unknown",
      kind: m.kind ?? 0,
      cls: m.cls,
      clsReason: m.clsReason,
      quarantined: m.quarantined,
      seeds: m.seeds,
      parents: m.parents,
      ...(m.signer ? { signer: m.signer } : {}),
      ...(m.anchorPos ? { block: m.anchorPos.block.toString(), logIndex: m.anchorPos.logIndex } : {}),
      ...(r?.anchor ? { cid: r.anchor.cid } : {}),
      verification: r?.status === "verified" ? "verified" : ((r as { reason?: string } | undefined)?.reason ?? "unknown"),
      ...(m.body !== undefined ? { body: m.body } : {}),
      src: m.header?.src ?? [],
      ...(m.header?.ts ? { ts: m.header.ts } : {}),
    };
  });
  const decisions: ViewDecision[] = memories
    .filter((m) => m.kind === Kind.Decision)
    .map((m) => {
      let b: Record<string, unknown> = {};
      try {
        b = JSON.parse(m.body ?? "{}") as Record<string, unknown>;
      } catch {
        b = {};
      }
      return {
        id: m.id,
        parents: m.parents,
        ...(typeof b.turn === "string" ? { turn: b.turn } : {}),
        ...(b.verdict ? { verdict: b.verdict as ViewDecision["verdict"] } : {}),
        ...(b.proposal ? { proposal: b.proposal as Record<string, unknown> } : {}),
        ...(typeof b.txHash === "string" ? { txHash: b.txHash } : {}),
      } as ViewDecision;
    });
  const str = (x: bigint) => x.toString();
  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    network: o.network,
    chainId: o.chainId,
    head: p.head.toString(),
    digest: p.digest,
    contracts: o.contracts,
    ...(o.explorer ? { explorer: o.explorer } : {}),
    ...(o.token ? { token: o.token } : {}),
    memories,
    decisions,
    seeds: p.snapshot.ledger.seeds.map((s) => ({ seedId: s.seedId, type: s.type, value: s.value, fromBlock: str(s.fromBlock), toBlock: str(s.toBlock), released: s.released })),
    payees: p.snapshot.ledger.payees.map((x) => ({ payeeId: x.payeeId, label: x.label, addr: x.addr, token: x.token, capPerTx: str(x.capPerTx), capPerDay: str(x.capPerDay), active: x.active, suspended: x.suspended })),
    incidents: o.incidents,
  };
}
