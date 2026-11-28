import type { ViewDecision, ViewDocument, ViewMemory } from "./view.js";

/*
 * The six read-only tools as pure functions of a view document, so they are tested without a server.
 * Results are small and capped. Text that someone else wrote (memory bodies, incident summaries, the
 * agent's stated reasons) is returned under keys ending in `_untrusted`, cleaned of control and
 * bidi characters and truncated: it is evidence to look at, never instructions to follow.
 */

export const LIMIT_MAX = 50;
const BLAST_MAX = 200;
const LIST_MAX = 64;

const SEED_TYPE: Record<number, string> = { 1: "memory", 2: "source", 3: "signer-window", 4: "turn" };
const KIND: Record<number, string> = { 1: "statement", 2: "observation", 3: "note", 4: "summary", 5: "decision" };

/** Strip control and bidi characters and cap the length. */
export function clean(s: unknown, max = 300): string {
  const t = String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const lower = (s: string) => s.toLowerCase();
const addrValue = (a: string) => `0x${lower(a).slice(2).padStart(64, "0")}`;
const cap = <T>(xs: T[], n: number) => ({ items: xs.slice(0, n), truncated: xs.length > n });
const blockNum = (b?: string) => (b && /^\d+$/.test(b) ? BigInt(b) : -1n);

/** tyrell_status: the deployment, the head the projection is at, and counts. */
export function status(v: ViewDocument) {
  const byClass: Record<string, number> = {};
  for (const m of v.memories) byClass[m.cls] = (byClass[m.cls] ?? 0) + 1;
  const outcome = { allowed: 0, blocked: 0, paid: 0, failed: 0, unknown: 0 };
  for (const d of v.decisions) {
    if (d.verdict?.decision === "ALLOW") outcome.allowed++;
    else if (d.verdict?.decision === "BLOCK") outcome.blocked++;
    if (d.outcome) outcome[d.outcome]++;
  }
  return {
    network: clean(v.network, 40),
    chainId: v.chainId,
    head: clean(v.head, 40),
    digest: clean(v.digest, 80),
    generatedAt: clean(v.generatedAt, 40),
    contracts: Object.fromEntries(Object.entries(v.contracts).slice(0, 20).map(([k, x]) => [clean(k, 40), clean(x, 80)])),
    ...(v.token ? { token: { address: clean(v.token.address, 60), symbol: clean(v.token.symbol, 20), decimals: v.token.decimals } } : {}),
    memories: { total: v.memories.length, byClass, quarantined: v.memories.filter((m) => m.quarantined).length },
    decisions: { total: v.decisions.length, ...outcome },
    incidents: v.incidents.length,
    seeds: { active: v.seeds.filter((s) => !s.released).length, released: v.seeds.filter((s) => s.released).length },
    payees: { active: v.payees.filter((p) => p.active && !p.suspended).length, suspended: v.payees.filter((p) => p.suspended).length },
  };
}

const srcMentions = (m: ViewMemory, a: string) => m.src.some((r) => JSON.stringify(r ?? null).toLowerCase().includes(a));

/** tyrell_check_address: is this address (a token, NFT contract, sender or recipient) quarantined, flagged, or a known payee? */
export function checkAddress(v: ViewDocument, address: string) {
  const a = lower(address);
  const value = addrValue(a);
  const seeds = v.seeds
    .filter((s) => (s.type === 2 || s.type === 3) && lower(s.value) === value)
    .map((s) => ({ seedId: s.seedId, type: SEED_TYPE[s.type] ?? String(s.type), released: s.released, ...(s.type === 3 ? { fromBlock: s.fromBlock, toBlock: s.toBlock } : {}) }));
  const payees = v.payees
    .filter((p) => lower(p.addr) === a)
    .map((p) => ({ label_untrusted: clean(p.label, 60), active: p.active, suspended: p.suspended, token: clean(p.token, 60), capPerTx: p.capPerTx, capPerDay: p.capPerDay }));
  const incidents = v.incidents.filter((i) => lower(i.source) === a);
  const memories = v.memories.filter((m) => srcMentions(m, a));
  const activeSeed = seeds.some((s) => !s.released);
  const verdict = activeSeed ? "quarantined" : incidents.length ? "flagged" : payees.some((p) => p.active && !p.suspended) ? "known_payee" : payees.length ? "suspended_payee" : "unknown";
  return {
    address: a,
    verdict,
    meaning: {
      quarantined: "an active quarantine seed covers it: memories from it are excluded and payments citing them are blocked",
      flagged: "the sentinel raised an incident about it, but no quarantine is active",
      known_payee: "it is a registered, active payee",
      suspended_payee: "it is a registered payee that is suspended or inactive",
      unknown: "Tyrell has no record of it",
    }[verdict],
    isOfficialToken: !!v.token && lower(v.token.address) === a,
    seeds,
    payees,
    incidents: { count: incidents.length, maxScore: incidents.reduce((n, i) => Math.max(n, i.score), 0) },
    memoriesFromIt: { count: memories.length, quarantined: memories.filter((m) => m.quarantined).length },
  };
}

/** tyrell_incidents: the most recent sentinel incidents, newest first. */
export function incidents(v: ViewDocument, limit = 10) {
  const byId = new Map(v.memories.map((m) => [m.id, m]));
  const sorted = [...v.incidents].sort((x, y) => (blockNum(y.block) > blockNum(x.block) ? 1 : blockNum(y.block) < blockNum(x.block) ? -1 : 0));
  const { items, truncated } = cap(sorted, Math.min(limit, LIMIT_MAX));
  return {
    total: v.incidents.length,
    truncated,
    incidents: items.map((i) => ({
      memoryId: clean(i.memoryId, 40),
      source: clean(i.source, 60),
      score: i.score,
      rules: i.rules.slice(0, 12).map((r) => clean(r, 40)),
      ...(i.block ? { block: clean(i.block, 20) } : {}),
      quarantined: byId.get(i.memoryId)?.quarantined ?? false,
      ...(i.ai ? { ai: { score: i.ai.score, injection: i.ai.injection, confidence: i.ai.confidence, category: clean(i.ai.category, 40) } } : {}),
      ...(i.summary !== undefined ? { summary_untrusted: clean(i.summary, 300) } : {}),
    })),
  };
}

function decisionRow(d: ViewDecision, byId: Map<string, ViewMemory>) {
  const p = d.proposal ?? {};
  return {
    id: clean(d.id, 40),
    ...(d.turn ? { turn: clean(d.turn, 40) } : {}),
    decision: clean(d.verdict?.decision ?? "UNKNOWN", 12),
    code: clean(d.verdict?.code ?? "", 40),
    rules_said: (d.verdict?.reasons ?? []).slice(0, 8).map((r) => clean(r, 160)),
    ...(p.recipient !== undefined ? { recipient: clean(p.recipient, 60) } : {}),
    ...(p.amount !== undefined ? { amount: clean(p.amount, 40) } : {}),
    ...(p.token !== undefined ? { token: clean(p.token, 60) } : {}),
    ...(p.payeeLabel !== undefined ? { payeeLabel_untrusted: clean(p.payeeLabel, 60) } : {}),
    ...(p.reason !== undefined ? { agentReason_untrusted: clean(p.reason, 200) } : {}),
    ...(d.outcome ? { outcome: d.outcome } : {}),
    ...(d.txHash ? { txHash: clean(d.txHash, 80) } : {}),
    ...(d.payError ? { payError: clean(d.payError, 200) } : {}),
    parents: d.parents.length,
    quarantinedParents: d.parents.filter((x) => byId.get(x)?.quarantined).length,
  };
}

/** tyrell_decisions: the most recent payment decisions, newest first, optionally only ALLOW or BLOCK. */
export function decisions(v: ViewDocument, limit = 10, verdict?: "ALLOW" | "BLOCK") {
  const byId = new Map(v.memories.map((m) => [m.id, m]));
  const all = [...v.decisions].reverse().filter((d) => !verdict || d.verdict?.decision === verdict);
  const { items, truncated } = cap(all, Math.min(limit, LIMIT_MAX));
  return { total: all.length, truncated, decisions: items.map((d) => decisionRow(d, byId)) };
}

/** tyrell_memory: one memory's provenance: lane, trust class, verification, quarantine, parents and children. */
export function memory(v: ViewDocument, id: string) {
  const want = lower(id);
  const m = v.memories.find((x) => lower(x.id) === want);
  if (!m) return { id: want, found: false as const };
  const children = v.memories.filter((x) => x.parents.some((p) => lower(p) === want)).map((x) => x.id);
  const parents = cap(m.parents, LIST_MAX);
  const kids = cap(children, LIST_MAX);
  const seeds = m.seeds.map((s) => {
    const seed = v.seeds.find((x) => x.seedId === s);
    return { seedId: s, ...(seed ? { type: SEED_TYPE[seed.type] ?? String(seed.type), released: seed.released } : {}) };
  });
  return {
    id: clean(m.id, 40),
    found: true as const,
    lane: m.lane,
    laneName: clean(m.laneName, 20),
    kind: KIND[m.kind] ?? String(m.kind),
    trust: clean(m.cls, 20),
    trustReason: clean(m.clsReason, 160),
    verification: clean(m.verification, 60),
    quarantined: m.quarantined,
    seeds,
    ...(m.signer ? { signer: clean(m.signer, 60) } : {}),
    ...(m.block ? { block: clean(m.block, 20) } : {}),
    ...(m.cid ? { cid: clean(m.cid, 100) } : {}),
    ...(m.ts ? { ts: clean(m.ts, 40) } : {}),
    sources: m.src.slice(0, 10).map((r) => clean(JSON.stringify(r ?? null), 300)),
    parents: parents.items,
    ...(parents.truncated ? { parentsTruncated: true } : {}),
    children: kids.items,
    ...(kids.truncated ? { childrenTruncated: true } : {}),
    ...(m.body !== undefined ? { body_untrusted: clean(m.body, 2000) } : { body: "not included in this view (control serves bodies only to its own machine)" }),
  };
}

/** tyrell_blast: everything one quarantine seed reaches: the memories, and the decisions among them. */
export function blast(v: ViewDocument, seedId: number) {
  const seed = v.seeds.find((s) => s.seedId === seedId);
  if (!seed) return { seedId, found: false as const, seeds: v.seeds.slice(0, LIMIT_MAX).map((s) => s.seedId) };
  const hit = v.memories.filter((m) => m.seeds.includes(seedId));
  const hitIds = new Set(hit.map((m) => m.id));
  const byId = new Map(v.memories.map((m) => [m.id, m]));
  const decs = v.decisions.filter((d) => hitIds.has(d.id));
  const mem = cap(hit, BLAST_MAX);
  return {
    seedId,
    found: true as const,
    seed: { type: SEED_TYPE[seed.type] ?? String(seed.type), value: clean(seed.value, 80), released: seed.released, ...(seed.type === 3 ? { fromBlock: seed.fromBlock, toBlock: seed.toBlock } : {}) },
    memories: { total: hit.length, truncated: mem.truncated, items: mem.items.map((m) => ({ id: m.id, lane: clean(m.laneName, 20), kind: KIND[m.kind] ?? String(m.kind), trust: clean(m.cls, 20) })) },
    decisions: { total: decs.length, items: decs.slice(0, LIMIT_MAX).map((d) => decisionRow(d, byId)) },
    payments: decs.filter((d) => d.txHash).map((d) => ({ decision: d.id, txHash: clean(d.txHash, 80), outcome: d.outcome ?? "unknown" })),
  };
}
