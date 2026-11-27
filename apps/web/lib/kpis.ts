import type { ViewDecision, ViewDocument } from "./view";

const RANK: Record<string, number> = { trusted: 4, derived: 3, untrusted: 2, unverified: 1 };

/** The four KPI cards of the dashboard, computed from the projection (no invented deltas). */
export function kpis(v: ViewDocument) {
  const mem = v.memories;
  const blocked = v.decisions.filter((d) => d.verdict?.decision === "BLOCK");
  const allowed = v.decisions.filter((d) => d.verdict?.decision === "ALLOW");
  const verified = mem.filter((m) => m.cls !== "unverified").length;
  return [
    {
      label: "Verified memories",
      value: String(verified),
      note: `${mem.filter((m) => m.cls === "trusted").length} trusted`,
      noteColor: "text-band-green",
      bars: mem.map((m) => RANK[m.cls] ?? 1),
      color: "#14b37f",
    },
    {
      label: "Decisions",
      value: String(v.decisions.length),
      note: `${allowed.length} allowed`,
      noteColor: "text-brand",
      bars: v.decisions.map((d) => d.parents.length + 1),
      color: "#7c5cff",
    },
    {
      label: "Untrusted reads",
      value: String(mem.filter((m) => m.cls === "untrusted").length),
      note: `${v.incidents.length} incidents`,
      noteColor: "text-[#e08a00]",
      bars: v.incidents.map((i) => i.score),
      color: "#ffb84d",
    },
    {
      label: "Payments blocked",
      value: String(blocked.length),
      note: `${mem.filter((m) => m.quarantined).length} quarantined`,
      noteColor: "text-rose",
      bars: v.decisions.map((d) => (d.verdict?.decision === "BLOCK" ? 3 : 1)),
      color: "#ff5c7a",
    },
  ];
}

export const RULES = [
  ["R0", "chain + ledger verified"],
  ["R1", "canonical address"],
  ["R2", "registered payee"],
  ["R3", "label matches"],
  ["R4", "token and caps"],
  ["R5", "vault simulation"],
] as const;

const FAILS_AT: Record<string, number> = {
  CHAIN_UNAVAILABLE: 0,
  LEDGER_UNVERIFIED: 0,
  BAD_RECIPIENT: 1,
  UNKNOWN_RECIPIENT: 2,
  PAYEE_SUSPENDED: 2,
  LABEL_MISMATCH: 3,
  ASSET_MISMATCH: 4,
  OVER_CAP: 4,
  OVER_DAILY_CAP: 4,
  AGENT_BLOCKED: 4,
  SIMULATION_FAILED: 5,
};

/** Each rule's state for a decision: passed, failed (the first BLOCK wins), or never reached. */
export function ruleTrace(d: ViewDecision): Array<{ id: string; name: string; state: "pass" | "fail" | "skip" }> {
  const at = d.verdict?.decision === "BLOCK" ? (FAILS_AT[d.verdict.code] ?? 0) : 99;
  return RULES.map(([id, name], i) => ({ id, name, state: i < at ? "pass" : i === at ? "fail" : "skip" }));
}
