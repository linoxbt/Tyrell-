import type { Address, Hex } from "viem";
import { Kind, TRUST_CLASSES, TRUST_RANK, type TrustClass } from "./constants.js";
import type { Header } from "./envelope.js";
import type { Id16 } from "./ids.js";
import { comparePos, type ChainPos } from "./keys.js";
import { seedMatches, srcRefValues, type Seed } from "./seeds.js";
import type { VerifyResult } from "./verifier.js";

/** Lowest class a lane can reach with only trusted parents (spec section 7, trust computation). */
const LANE_BASE: Record<number, TrustClass> = { 1: "trusted", 2: "derived", 3: "untrusted", 4: "derived" };

export interface MemoryState {
  id: Id16;
  cls: TrustClass;
  /** Why the class is what it is, for the forensic view. */
  clsReason: string;
  quarantined: boolean;
  /** Seeds that quarantine this memory, directly or through an ancestor. */
  seeds: number[];
  lane?: number;
  kind?: number;
  parents: Id16[];
  bodyHash?: Hex;
  signer?: Address;
  anchorPos?: ChainPos;
  header?: Header;
  body?: string;
}

export type Projection = Map<Id16, MemoryState>;

/**
 * Computes every memory's trust class and quarantine flag in one topological pass (I-3, I-8).
 *
 * Memories are processed in anchor order. A parent must be anchored strictly before its child, so
 * anchor order is a topological order and cycles are impossible: a parent anchored at or after the
 * child makes the child unverified. Quarantine is recomputed from the active seeds on every call, so
 * descendants written after a seed are excluded without a new seed.
 */
export function computeProjection(results: readonly VerifyResult[], seeds: readonly Seed[]): Projection {
  const active = seeds.filter((s) => !s.released);
  const byId = new Map<Id16, VerifyResult>();
  for (const r of results) byId.set(r.id.toLowerCase() as Id16, r);
  const ordered = [...byId.values()].sort((a, b) => {
    if (!a.anchor && !b.anchor) return a.id < b.id ? -1 : 1;
    if (!a.anchor) return 1;
    if (!b.anchor) return -1;
    return comparePos(a.anchor.pos, b.anchor.pos);
  });

  const out: Projection = new Map();
  for (const r of ordered) {
    const id = r.id.toLowerCase() as Id16;
    const header = r.header;
    const parents = header?.parents ?? [];
    const state: MemoryState = {
      id,
      cls: "unverified",
      clsReason: "",
      quarantined: false,
      seeds: [],
      parents,
      ...(header ? { lane: header.lane, kind: header.kind } : r.anchor ? { lane: r.anchor.lane } : {}),
      ...(r.anchor ? { bodyHash: r.anchor.bodyHash, anchorPos: r.anchor.pos } : {}),
      ...(r.status === "verified" ? { signer: r.signer, header: r.header, body: r.body } : r.anchor ? { signer: r.anchor.signer } : {}),
      ...(r.status === "unverified" && header ? { header } : {}),
    };

    // Quarantine: direct seed matches, then inherited from parents (computed below).
    const seedSet = new Set<number>();
    for (const s of active) {
      if (seedMatches(s, { id, ...(header ? { header } : {}), ...(state.signer ? { signer: state.signer } : {}), ...(state.anchorPos ? { anchorPos: state.anchorPos } : {}) })) {
        seedSet.add(s.seedId);
      }
    }

    let worstParent: TrustClass = "trusted";
    let parentNote = "";
    let orderBroken = false;
    for (const p of parents) {
      const ps = out.get(p);
      if (!ps) {
        const later = byId.get(p);
        if (later?.anchor && r.anchor) {
          orderBroken = true; // parent exists but is anchored at or after this memory
          parentNote = `parent ${p} anchored after child`;
        } else {
          worstParent = worse(worstParent, "untrusted");
          parentNote ||= `dangling parent ${p}`;
        }
        continue;
      }
      for (const sid of ps.seeds) seedSet.add(sid);
      const pc: TrustClass = ps.cls === "unverified" ? "untrusted" : ps.cls;
      if (TRUST_RANK[pc] > TRUST_RANK[worstParent]) {
        worstParent = pc;
        parentNote = `parent ${p} is ${ps.cls}`;
      }
    }

    if (r.status === "unverified") {
      state.cls = "unverified";
      state.clsReason = r.reason;
    } else if (orderBroken) {
      state.cls = "unverified";
      state.clsReason = `PARENT_ORDER: ${parentNote}`;
    } else {
      const base = LANE_BASE[r.header.lane]!;
      state.cls = worse(base, worstParent);
      state.clsReason = state.cls === base ? `${base} by lane` : parentNote;
    }

    state.seeds = [...seedSet].sort((a, b) => a - b);
    state.quarantined = state.seeds.length > 0;
    out.set(id, state);
  }
  return out;
}

const worse = (a: TrustClass, b: TrustClass): TrustClass => (TRUST_RANK[a] >= TRUST_RANK[b] ? a : b);

/** Memories the model and the policy engine may see: verified, not quarantined (I-7). */
export const visible = (p: Projection): MemoryState[] => [...p.values()].filter((m) => m.cls !== "unverified" && !m.quarantined);

export const lowestClass = (classes: readonly TrustClass[]): TrustClass =>
  classes.reduce<TrustClass>((acc, c) => worse(acc, c), TRUST_CLASSES[0]);

// ------------------------------------------------------------------ blast radius

export interface BlastNode {
  id: string;
  type: "source" | "memory" | "decision";
  label: string;
  lane?: number;
  cls?: TrustClass;
  quarantined?: boolean;
}

export interface BlastRadius {
  seedId: number;
  memories: Id16[];
  decisions: Id16[];
  vaultTxs: Hex[];
  nodes: BlastNode[];
  edges: Array<{ from: string; to: string }>;
}

/**
 * The quarantined set one seed produces, plus the decisions in it and the vault transactions they
 * reference (spec section 7). Edges run source -> memory and parent -> child.
 */
export function blastRadius(seedId: number, p: Projection): BlastRadius {
  const hit = [...p.values()].filter((m) => m.seeds.includes(seedId));
  const inSet = new Set(hit.map((m) => m.id));
  const nodes: BlastNode[] = [];
  const edges: Array<{ from: string; to: string }> = [];
  const sources = new Map<string, BlastNode>();
  const decisions: Id16[] = [];
  const vaultTxs: Hex[] = [];

  for (const m of hit) {
    const isDecision = m.kind === Kind.Decision;
    nodes.push({
      id: m.id,
      type: isDecision ? "decision" : "memory",
      label: m.body ? m.body.slice(0, 80) : m.id,
      ...(m.lane !== undefined ? { lane: m.lane } : {}),
      cls: m.cls,
      quarantined: m.quarantined,
    });
    if (isDecision) {
      decisions.push(m.id);
      const tx = decisionTxHash(m.body);
      if (tx) vaultTxs.push(tx);
    }
    for (const parent of m.parents) if (inSet.has(parent)) edges.push({ from: parent, to: m.id });
    for (const ref of m.header?.src ?? []) {
      const key = `src:${srcRefValues(ref)[0]}`;
      if (!sources.has(key)) {
        const label = "addr" in ref ? `${ref.t} ${ref.addr}` : ref.t === "mcp" ? `mcp ${ref.tool}` : ref.t;
        sources.set(key, { id: key, type: "source", label });
      }
      edges.push({ from: key, to: m.id });
    }
  }
  return { seedId, memories: hit.map((m) => m.id), decisions, vaultTxs, nodes: [...sources.values(), ...nodes], edges };
}

/** Decision bodies are JSON with an optional `txHash` (written by control, Phase 4). */
function decisionTxHash(body: string | undefined): Hex | undefined {
  if (!body) return undefined;
  try {
    const v = JSON.parse(body) as { txHash?: unknown };
    return typeof v.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(v.txHash) ? (v.txHash.toLowerCase() as Hex) : undefined;
  } catch {
    return undefined;
  }
}
