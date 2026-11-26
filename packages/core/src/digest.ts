import type { Address, Hex } from "viem";
import { canonicalHash, canonicalJson } from "./canonical.js";
import type { Projection } from "./lineage.js";
import type { Seed } from "./seeds.js";

/** Payee state as read from TyrellLedger. */
export interface PayeeRecord {
  payeeId: Hex;
  addr: Address;
  token: Address;
  capPerTx: bigint;
  capPerDay: bigint;
  label: string;
  active: boolean;
  suspended: boolean;
}

export interface DigestInput {
  acct: Hex;
  head: bigint;
  projection: Projection;
  payees: readonly PayeeRecord[];
  seeds: readonly Seed[];
}

const lc = (s: string) => s.toLowerCase();

/**
 * The document the projection digest hashes (spec section 11). Integers that may exceed 2^53 are
 * decimal strings; addresses and hashes are lowercase; every list is sorted by its key.
 */
export function digestDocument(d: DigestInput) {
  return {
    v: 1,
    acct: lc(d.acct),
    head: d.head.toString(),
    memories: [...d.projection.values()]
      .map((m) => ({ id: lc(m.id), lane: m.lane ?? 0, cls: m.cls, q: m.quarantined, bodyHash: m.bodyHash ? lc(m.bodyHash) : null }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    payees: [...d.payees]
      .map((p) => ({
        payeeId: lc(p.payeeId),
        addr: lc(p.addr),
        token: lc(p.token),
        capPerTx: p.capPerTx.toString(),
        capPerDay: p.capPerDay.toString(),
        active: p.active,
        suspended: p.suspended,
      }))
      .sort((a, b) => (a.payeeId < b.payeeId ? -1 : 1)),
    seeds: [...d.seeds]
      .map((s) => ({ seedId: s.seedId, type: s.type, value: lc(s.value), from: s.fromBlock.toString(), to: s.toBlock.toString(), released: s.released }))
      .sort((a, b) => a.seedId - b.seedId),
  };
}

/** keccak256 of the RFC 8785 canonical JSON of the digest document (I-10). */
export const projectionDigest = (d: DigestInput): Hex => canonicalHash(digestDocument(d));

/** First record where two digest documents differ, for `tyrell verify --head` (spec section 11). */
export function firstDifference(a: ReturnType<typeof digestDocument>, b: ReturnType<typeof digestDocument>): string | undefined {
  for (const k of ["v", "acct", "head"] as const) if (a[k] !== b[k]) return `${k}: ${String(a[k])} != ${String(b[k])}`;
  for (const k of ["memories", "payees", "seeds"] as const) {
    const x = a[k] as unknown[];
    const y = b[k] as unknown[];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const l = canonicalJson(x[i] ?? null);
      const r = canonicalJson(y[i] ?? null);
      if (l !== r) return `${k}[${i}]: ${l} != ${r}`;
    }
  }
  return undefined;
}
