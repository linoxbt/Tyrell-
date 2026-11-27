import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

// Mirrors apps/control/src/view.ts (kept separate so the browser bundle has no Node dependencies).
export interface ViewMemory {
  id: string;
  lane: number;
  laneName: string;
  kind: number;
  cls: "trusted" | "derived" | "untrusted" | "unverified";
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
  src: Array<Record<string, unknown>>;
  ts?: string;
}

export interface ViewDecision {
  id: string;
  turn?: string;
  verdict?: { decision: "ALLOW" | "BLOCK"; code: string; reasons: string[] };
  proposal?: Record<string, unknown>;
  txHash?: string;
  parents: string[];
}

export interface ViewDocument {
  v: 1;
  generatedAt: string;
  network: string;
  chainId: number;
  head: string;
  digest: string;
  contracts: Record<string, string>;
  explorer?: string;
  token?: { address: string; decimals: number; symbol: string };
  memories: ViewMemory[];
  decisions: ViewDecision[];
  seeds: Array<{ seedId: number; type: number; value: string; fromBlock: string; toBlock: string; released: boolean }>;
  payees: Array<{ payeeId: string; label: string; addr: string; token: string; capPerTx: string; capPerDay: string; active: boolean; suspended: boolean }>;
  incidents: Array<{ memoryId: string; source: string; score: number; rules: string[]; summary: string; block: string }>;
}

export const KIND: Record<number, string> = { 1: "statement", 2: "observation", 3: "note", 4: "summary", 5: "decision" };
export const SEED_TYPE: Record<number, string> = { 1: "memory", 2: "source", 3: "signer-window", 4: "turn" };
export const LANE_COLOR: Record<number, string> = { 1: "#2563eb", 2: "#7c3aed", 3: "#ea580c", 4: "#57534e" };
export const CLS_STYLE: Record<string, string> = {
  trusted: "bg-emerald-100 text-emerald-800",
  derived: "bg-sky-100 text-sky-800",
  untrusted: "bg-amber-100 text-amber-900",
  unverified: "bg-rose-100 text-rose-800",
};

/** Base units as a token amount, e.g. 5000000 -> "5 QUSDC", when the view knows the token. */
export function amount(view: ViewDocument, base: unknown): string {
  const s = String(base ?? "");
  if (!/^\d+$/.test(s) || !view.token) return `${s} base units`;
  const d = view.token.decimals;
  const whole = s.length > d ? s.slice(0, -d) : "0";
  const frac = s.padStart(d + 1, "0").slice(-d).replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} ${view.token.symbol}`;
}

export const short = (h: string, n = 6) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

/** Text shown for a memory: decision bodies are JSON, notes are {text}, everything else is plain. */
export function bodyText(m: ViewMemory): string {
  if (!m.body) return "(body unavailable)";
  try {
    const j = JSON.parse(m.body) as { text?: string; verdict?: { decision: string; code: string }; proposal?: { recipient?: string; amount?: string } };
    if (j.verdict) return `${j.verdict.decision} ${j.verdict.code}${j.proposal?.recipient ? ` → ${short(j.proposal.recipient)}` : ""}`;
    if (typeof j.text === "string") return j.text;
  } catch {
    /* plain text */
  }
  return m.body;
}

const srcKey = (r: Record<string, unknown>) => `src:${String(r.t)}:${String(r.addr ?? r.tool ?? r.id ?? r.url ?? "")}`.toLowerCase();
const srcLabel = (r: Record<string, unknown>) => (r.addr ? `${String(r.t)} ${short(String(r.addr))}` : r.tool ? `mcp ${String(r.tool)}` : String(r.t));

export interface Graph {
  nodes: Node[];
  edges: Edge[];
  memoryIds: string[];
  decisionIds: string[];
}

/**
 * The blast radius of a seed, computed the way control computes it (packages/core lineage.ts): every
 * memory whose seed list contains it, the decisions among them, parent -> child edges inside the set,
 * and source -> memory edges from their src refs.
 */
export function graphFor(view: ViewDocument, filter: { seedId?: number; last?: number }): Graph {
  const all = view.memories;
  const set = filter.seedId !== undefined ? all.filter((m) => m.seeds.includes(filter.seedId!)) : all.slice(-(filter.last ?? 60));
  const inSet = new Set(set.map((m) => m.id));
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const sources = new Map<string, Node>();
  for (const m of set) {
    nodes.push({ id: m.id, type: "memory", data: { m }, position: { x: 0, y: 0 } });
    for (const p of m.parents) if (inSet.has(p)) edges.push({ id: `${p}->${m.id}`, source: p, target: m.id });
    for (const r of m.src) {
      if (r.t === "user-msg") continue;
      const k = srcKey(r);
      if (!sources.has(k)) sources.set(k, { id: k, type: "source", data: { label: srcLabel(r) }, position: { x: 0, y: 0 } });
      edges.push({ id: `${k}->${m.id}`, source: k, target: m.id, style: { strokeDasharray: "4 3" } });
    }
  }
  const allNodes = [...sources.values(), ...nodes];
  return layout(allNodes, edges, set.map((m) => m.id), set.filter((m) => m.kind === 5).map((m) => m.id));
}

function layout(nodes: Node[], edges: Edge[], memoryIds: string[], decisionIds: string[]): Graph {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 70 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.type === "source" ? 170 : 230, height: n.type === "source" ? 40 : 86 });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return {
    nodes: nodes.map((n) => {
      const p = g.node(n.id) as { x: number; y: number; width: number; height: number };
      return { ...n, position: { x: p.x - p.width / 2, y: p.y - p.height / 2 } };
    }),
    edges,
    memoryIds,
    decisionIds,
  };
}
