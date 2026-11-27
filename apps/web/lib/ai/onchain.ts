import { isAddress, parseUnits, type Address } from "viem";
import { Chain, fmt, Revert, type Step } from "../playground/chain";
import { addr, D, payeeIdOf, USD, vaultWorld } from "../playground/suite";
import type { DemoResult, Proposal } from "./demo";
import { ATTACKER, LANDLORD } from "./scenarios";

/*
 * The live AI run's outcome, executed on Tyrell's real contracts in the browser:
 *  - Tyrell: the vault holds 10 QUSDC and knows one payee, the landlord. An ALLOW is paid through
 *    GuardedVault.pay; a BLOCK sends nothing, and the vault is also asked to pay the model's recipient
 *    directly, to show it would refuse even without the policy engine.
 *  - Unprotected: a plain wallet with 10 QUSDC does whatever the model proposed (an ERC-20 transfer).
 */

export interface Outcome {
  proposal: Proposal;
  result: "paid" | "blocked" | "refused" | "sent" | "failed";
  detail: string;
}
export interface Side {
  outcomes: Outcome[];
  balances: { landlord: bigint; attacker: bigint; funds: bigint };
  steps: Step[];
}

const amountOf = (p: Proposal) => {
  try {
    return parseUnits(p.amount.trim(), 6);
  } catch {
    return undefined;
  }
};
const why = (e: unknown) => (e instanceof Revert ? `${e.errorName}(${e.args.map(fmt).join(", ")})` : (e as Error).message);

export async function settleTyrell(run: DemoResult): Promise<Side> {
  const c = await Chain.create();
  const w = await vaultWorld(c);
  const outcomes: Outcome[] = [];
  for (const p of run.steward.proposals) {
    const amount = amountOf(p);
    if (p.verdict?.decision === "ALLOW" && amount !== undefined) {
      try {
        await c.send(w.signer, w.vault, "GuardedVault", "pay", [payeeIdOf("landlord"), w.usd, amount, D(`ai-demo:${outcomes.length}`)]);
        outcomes.push({ proposal: p, result: "paid", detail: `GuardedVault paid ${p.amount} QUSDC to the landlord` });
      } catch (e) {
        outcomes.push({ proposal: p, result: "refused", detail: `the vault refused: ${why(e)}` });
      }
      continue;
    }
    // blocked off-chain; the vault has no payee for that address either
    const label = isAddress(p.recipient.trim()) && p.recipient.trim().toLowerCase() === LANDLORD.toLowerCase() ? "landlord" : `unregistered:${p.recipient}`;
    try {
      await c.send(w.signer, w.vault, "GuardedVault", "pay", [payeeIdOf(label), w.usd, amount ?? USD(5), D(`ai-demo:${outcomes.length}`)]);
      outcomes.push({ proposal: p, result: "paid", detail: "the vault paid (unexpected)" });
    } catch (e) {
      outcomes.push({ proposal: p, result: "blocked", detail: `policy ${p.verdict?.code ?? "BLOCK"}; asked directly, the vault refuses too: ${why(e)}` });
    }
  }
  const bal = (a: Address) => c.read<bigint>(w.usd, "TyrellTestUSD", "balanceOf", [a]);
  return { outcomes, balances: { landlord: await bal(w.landlord), attacker: await bal(w.attacker), funds: await bal(w.vault) }, steps: c.steps };
}

export async function settleUnprotected(run: DemoResult): Promise<Side> {
  const c = await Chain.create();
  const owner = c.label(addr("owner"), "token owner");
  const wallet = c.label(addr("plain-wallet"), "plain wallet");
  c.label(LANDLORD, "landlord");
  c.label(ATTACKER, "attacker");
  const usd = await c.deploy("TyrellTestUSD", owner, [owner], "QUSDC (test)");
  await c.send(owner, usd, "TyrellTestUSD", "mint", [wallet, USD(10)]);
  const outcomes: Outcome[] = [];
  for (const p of run.unprotected.proposals) {
    const amount = amountOf(p);
    const to = p.recipient.trim();
    if (!isAddress(to) || amount === undefined) {
      outcomes.push({ proposal: p, result: "failed", detail: "not a valid transfer" });
      continue;
    }
    try {
      await c.send(wallet, usd, "TyrellTestUSD", "transfer", [to, amount]);
      outcomes.push({ proposal: p, result: "sent", detail: `the wallet sent ${p.amount} QUSDC to ${c.who(to as Address)}` });
    } catch (e) {
      outcomes.push({ proposal: p, result: "failed", detail: why(e) });
    }
  }
  const bal = (a: Address) => c.read<bigint>(usd, "TyrellTestUSD", "balanceOf", [a]);
  return { outcomes, balances: { landlord: await bal(LANDLORD), attacker: await bal(ATTACKER), funds: await bal(wallet) }, steps: c.steps };
}
