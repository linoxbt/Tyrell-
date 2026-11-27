/** Plain-English wording for the playground: what each refusal means, and what each group of checks proves. */

export const WHY_BLOCKED: Record<string, string> = {
  UNKNOWN_RECIPIENT: "that address is not on your list of approved payees",
  LABEL_MISMATCH: "the name doesn't match the payee you approved",
  OVER_CAP: "it is more than you allowed per payment",
  OVER_DAILY_CAP: "it is more than you allowed per day",
  OVER_GLOBAL_DAILY_CAP: "it is more than your total daily limit",
  ASSET_MISMATCH: "it is the wrong currency",
  PAYEE_SUSPENDED: "that payee was frozen after an attack",
  BAD_RECIPIENT: "that is not a valid address",
  CHAIN_UNAVAILABLE: "Tyrell could not reach the blockchain",
  LEDGER_UNVERIFIED: "Tyrell could not confirm the blockchain's state",
  SIMULATION_FAILED: "the vault would have refused it",
  AGENT_BLOCKED: "this AI agent is not allowed to make that payment",
};
export const whyBlocked = (code?: string) => (code && WHY_BLOCKED[code]) ?? "it broke one of your rules";

/** The live suite's five groups, as the claim each one proves. */
export const CLAIMS: Record<string, { title: string; text: string }> = {
  memory: { title: "Nobody can forge your agent's memory", text: "Every memory is signed. Forged, unsigned or stolen-key memories are rejected by the contract." },
  vault: { title: "Money only goes to people you approved", text: "The vault pays your approved payees within your limits, and nothing else, even with a stolen key." },
  "phase-a": { title: "Every AI agent answers to a real person", text: "Each agent is tied to a human's QIE ID, with its own permissions and spending limits." },
  "phase-b": { title: "Misbehaving agents pay for it", text: "Agents put down a deposit. Proven abuse costs them part of it, and three strikes bans them." },
  offchain: { title: "The safety rules work the same everywhere", text: "The exact payment rules and scam detector used by Tyrell, run here in your browser." },
};
