import { isAddress, type Address, type Hex } from "viem";
import type { PayeeRecord } from "./digest.js";

/**
 * Payment policy engine (spec section 9, I-5, I-6). A pure function: no I/O, no clock reads, no model
 * calls. Everything it needs is passed in, so every rule and block code is unit-testable.
 * Citations and reasons in the proposal are never read: they cannot change a verdict.
 */

/** What Steward's `propose_payment` tool produces, after the runtime converts the amount to base units. */
export interface PaymentProposal {
  recipient: string;
  amount: bigint;
  token: string;
  payeeLabel?: string;
  reason?: string;
  cites?: readonly string[];
}

export interface PayeeState extends PayeeRecord {
  /** GuardedVault.spentToday(payeeId) at the evaluated block. */
  spentToday: bigint;
}

export interface LedgerState {
  /** Ledger and LaneRegistry reads succeeded and matched on two RPC endpoints. */
  verified: boolean;
  payees: readonly PayeeState[];
  /** GuardedVault.globalDailyCap(token), keyed by lowercase token address. */
  globalDailyCap: Readonly<Record<string, bigint>>;
  /** GuardedVault.spentTodayGlobal(token), keyed by lowercase token address. */
  spentTodayGlobal: Readonly<Record<string, bigint>>;
  /** The UTC day (timestamp / 86400) the spend figures were read for. */
  day: bigint;
}

export type Simulation = { ok: true; gas: bigint } | { ok: false; error: string };

export interface ChainState {
  /** Two RPC endpoints answered and agree on head and contract state. */
  endpointsAgree: boolean;
  /** Every memory in the turn's context passed verification. */
  contextVerified: boolean;
  blockNumber: bigint;
  /** Block timestamp; "today" is blockTimestamp / 86400, the same boundary GuardedVault uses. */
  blockTimestamp: bigint;
  /** eth_call + gas estimate of GuardedVault.pay(...) from the signer address (R5). */
  simulation?: Simulation;
}

export const BLOCK_CODES = [
  "CHAIN_UNAVAILABLE",
  "LEDGER_UNVERIFIED",
  "BAD_RECIPIENT",
  "UNKNOWN_RECIPIENT",
  "PAYEE_SUSPENDED",
  "LABEL_MISMATCH",
  "ASSET_MISMATCH",
  "OVER_CAP",
  "OVER_DAILY_CAP",
  "AGENT_BLOCKED",
  "SIMULATION_FAILED",
] as const;
export type BlockCode = (typeof BLOCK_CODES)[number];

export interface PayCall {
  payeeId: Hex;
  to: Address;
  token: Address;
  amount: bigint;
}

export type Verdict =
  | { decision: "ALLOW"; code: "OK"; reasons: string[]; payeeId: Hex; call: PayCall }
  | { decision: "BLOCK"; code: BlockCode; reasons: string[]; payeeId?: Hex };

/**
 * Agents network, phase A: AgentRegistry.check(agentId, payeeId, token, amount) for the proposing agent,
 * read by control at the evaluated block on two endpoints. The registry is the authority (it checks the
 * human's live QIE ID binding, the agent's permissions, delegated payees, limits and the human's quota);
 * the engine fails closed if the read was not verified and blocks with the registry's code otherwise.
 */
export interface AgentCheck {
  agentId: bigint;
  /** The read succeeded and matched on two endpoints. */
  verified: boolean;
  ok: boolean;
  /** The registry's code when !ok, e.g. HUMAN_UNBOUND, OVER_HUMAN_QUOTA. */
  code: string;
}

export const SECONDS_PER_DAY = 86_400n;
export const utcDay = (timestamp: bigint): bigint => timestamp / SECONDS_PER_DAY;

const block = (code: BlockCode, reason: string, payeeId?: Hex): Verdict =>
  payeeId ? { decision: "BLOCK", code, reasons: [reason], payeeId } : { decision: "BLOCK", code, reasons: [reason] };

/** Labels compare after trim and ASCII lower-casing only: a homoglyph such as "landIord" does not match. */
const normLabel = (s: string): string => s.trim().toLowerCase();

/**
 * Rules R0-R4: everything that does not need a simulation. Control runs this first, simulates the
 * resulting call, then calls `evaluatePayment` with the simulation for the final verdict.
 */
export function checkRules(p: PaymentProposal, ledger: LedgerState, chain: ChainState): Verdict {
  // R0: fail closed if chain or ledger state cannot be verified (I-6)
  if (!chain.endpointsAgree) return block("CHAIN_UNAVAILABLE", "RPC endpoints unavailable or disagree");
  if (!ledger.verified) return block("LEDGER_UNVERIFIED", "ledger or registry reads not verified on two endpoints");
  if (!chain.contextVerified) return block("LEDGER_UNVERIFIED", "a memory in the turn's context failed verification");
  if (ledger.day !== utcDay(chain.blockTimestamp)) return block("LEDGER_UNVERIFIED", "spend figures are not for the current UTC day");

  // R1: a canonical EVM address; names are never resolved at payment time
  if (!/^0x[0-9a-fA-F]{40}$/.test(p.recipient) || !isAddress(p.recipient, { strict: true })) {
    return block("BAD_RECIPIENT", "recipient is not a canonical address with a valid checksum");
  }
  const recipient = p.recipient.toLowerCase();

  // R2: an active, non-suspended payee at that address
  const atAddress = ledger.payees.filter((x) => x.addr.toLowerCase() === recipient);
  const payable = atAddress.filter((x) => x.active && !x.suspended);
  if (payable.length === 0) {
    const suspended = atAddress.find((x) => x.active && x.suspended);
    if (suspended) return block("PAYEE_SUSPENDED", `payee ${suspended.label} is suspended by a quarantine seed`, suspended.payeeId);
    return block("UNKNOWN_RECIPIENT", "recipient is not a registered payee");
  }

  // R3: a label, if given, must name a payee at that same address
  let candidates = payable;
  if (p.payeeLabel !== undefined) {
    const label = normLabel(p.payeeLabel);
    candidates = payable.filter((x) => normLabel(x.label) === label);
    if (candidates.length === 0) return block("LABEL_MISMATCH", `label "${p.payeeLabel}" does not name the payee at ${p.recipient}`);
  }

  // R4: token, per-transaction cap, daily caps
  const token = p.token.toLowerCase();
  const payee = candidates.find((x) => x.token.toLowerCase() === token);
  if (!payee) return block("ASSET_MISMATCH", "token is not the payee's token", candidates[0]!.payeeId);
  if (p.amount <= 0n || p.amount > payee.capPerTx) return block("OVER_CAP", `amount must be > 0 and <= ${payee.capPerTx}`, payee.payeeId);
  if (payee.spentToday + p.amount > payee.capPerDay) {
    return block("OVER_DAILY_CAP", `payee daily cap ${payee.capPerDay}, spent ${payee.spentToday}`, payee.payeeId);
  }
  const globalCap = ledger.globalDailyCap[token] ?? 0n;
  const globalSpent = ledger.spentTodayGlobal[token] ?? 0n;
  if (globalSpent + p.amount > globalCap) {
    return block("OVER_DAILY_CAP", `vault daily cap ${globalCap} for this token, spent ${globalSpent}`, payee.payeeId);
  }

  return {
    decision: "ALLOW",
    code: "OK",
    reasons: ["R0-R4 passed"],
    payeeId: payee.payeeId,
    call: { payeeId: payee.payeeId, to: payee.addr, token: payee.token, amount: p.amount },
  };
}

/** R4a: a proposal from a registered agent must also pass the agent registry for the chosen payee. */
export function checkAgent(v: Verdict, agent: AgentCheck | undefined): Verdict {
  if (v.decision === "BLOCK" || !agent) return v;
  if (!agent.verified) return block("LEDGER_UNVERIFIED", `agent ${agent.agentId} registry state not verified on two endpoints`, v.payeeId);
  if (!agent.ok) return block("AGENT_BLOCKED", `agent ${agent.agentId}: ${agent.code}`, v.payeeId);
  return v;
}

/** Rules R0-R5 in order; the first BLOCK wins. Without a successful simulation nothing is allowed. */
export function evaluatePayment(p: PaymentProposal, ledger: LedgerState, chain: ChainState, agent?: AgentCheck): Verdict {
  const v = checkAgent(checkRules(p, ledger, chain), agent);
  if (v.decision === "BLOCK") return v;
  // R5
  if (!chain.simulation) return block("SIMULATION_FAILED", "GuardedVault.pay was not simulated", v.payeeId);
  if (!chain.simulation.ok) return block("SIMULATION_FAILED", `simulation reverted: ${chain.simulation.error}`, v.payeeId);
  return { ...v, reasons: ["R0-R5 passed"] };
}
