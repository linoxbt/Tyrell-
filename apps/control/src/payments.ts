import { BaseError, ContractFunctionRevertedError, type Address, type Hex, type PublicClient } from "viem";
import type { LocalAccount } from "viem/accounts";
import {
  checkRules,
  evaluatePayment,
  Kind,
  Lane,
  payRequestDigest,
  signEnvelope,
  utcDay,
  uuidv7,
  type ChainState,
  type Id16,
  type LedgerState,
  type PayeeState,
  type PaymentProposal,
  type Simulation,
  type Verdict,
} from "@tyrell/core";
import { guardedVaultAbi } from "@tyrell/chain";
import type { Proposal } from "@tyrell/ipc";
import { anchorDomain, type BuiltProjection } from "./projection.js";
import type { Control } from "./control.js";

/** A pay request as sent to the signer process: the exact call, signed by the control lane key. */
export interface SignedPayRequest {
  payeeId: Hex;
  token: Address;
  amount: string;
  decisionId: Id16;
  controlSig: Hex;
}

export type SignerTransport = (r: SignedPayRequest) => Promise<{ txHash: Hex }>;

export interface PaymentsOptions {
  control: Control;
  clients: PublicClient[];
  /** The control lane key: signs decision memories and pay requests. */
  controlKey: LocalAccount;
  /** The vault signer's public address, for R5 simulation. Its key lives only in the signer process. */
  signerAddress: Address;
  signer: SignerTransport;
}

export interface Decision {
  decisionId: Id16;
  verdict: Verdict;
  txHash?: Hex;
  payError?: string;
  /** The decision memory's anchor (same id as decisionId). */
  anchored: { id: Id16; txHash: Hex };
}

const asJson = (v: Verdict) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/**
 * The payment path (spec section 9): the model can only propose. Control evaluates R0-R5 on chain state
 * it read and cross-checked itself, simulates the exact vault call, hands an ALLOW to the signer, and
 * always writes a control-lane decision memory whose parents are the turn's readSet (FR-11).
 */
export class Payments {
  constructor(private readonly o: PaymentsOptions) {}

  private get d() {
    return this.o.control.deployment;
  }

  /** Ledger and vault state at the projection's head, read on two endpoints (R0, NFR-05). */
  async ledgerState(p: BuiltProjection): Promise<{ ledger: LedgerState; chain: Omit<ChainState, "contextVerified" | "simulation"> }> {
    const head = p.head;
    const payees = p.snapshot.ledger.payees;
    const tokens = [...new Set(payees.map((x) => x.token.toLowerCase() as Address))];
    const read = async (c: PublicClient) => {
      const block = await c.getBlock({ blockNumber: head });
      const spent = await Promise.all(
        payees.map((x) => c.readContract({ address: this.d.guardedVault, abi: guardedVaultAbi, functionName: "spentToday", args: [x.payeeId], blockNumber: head })),
      );
      const caps = await Promise.all(tokens.map((t) => c.readContract({ address: this.d.guardedVault, abi: guardedVaultAbi, functionName: "globalDailyCap", args: [t], blockNumber: head })));
      const global = await Promise.all(tokens.map((t) => c.readContract({ address: this.d.guardedVault, abi: guardedVaultAbi, functionName: "spentTodayGlobal", args: [t], blockNumber: head })));
      return { block, spent, caps, global };
    };
    let a, b;
    let agree = true;
    try {
      [a, b] = await Promise.all([read(this.o.clients[0]!), read(this.o.clients[1] ?? this.o.clients[0]!)]);
      const key = (r: Awaited<ReturnType<typeof read>>) => JSON.stringify([r.block.hash, r.spent, r.caps, r.global], (_k, x) => (typeof x === "bigint" ? x.toString() : x));
      agree = key(a) === key(b) && this.o.clients.length >= 2;
    } catch {
      agree = false;
    }
    const r = a!;
    const states: PayeeState[] = payees.map((x, i) => ({ ...x, spentToday: r?.spent[i] ?? 0n }));
    const ts = r?.block.timestamp ?? 0n;
    return {
      ledger: {
        verified: agree,
        payees: states,
        globalDailyCap: Object.fromEntries(tokens.map((t, i) => [t, r?.caps[i] ?? 0n])),
        spentTodayGlobal: Object.fromEntries(tokens.map((t, i) => [t, r?.global[i] ?? 0n])),
        day: utcDay(ts),
      },
      chain: { endpointsAgree: agree, blockNumber: head, blockTimestamp: ts },
    };
  }

  /** R5: eth_call and gas estimate of GuardedVault.pay from the signer address. */
  async simulate(payeeId: Hex, token: Address, amount: bigint, decisionId: Id16): Promise<Simulation> {
    const c = this.o.clients[0]!;
    const call = { address: this.d.guardedVault, abi: guardedVaultAbi, functionName: "pay", args: [payeeId, token, amount, decisionId], account: this.o.signerAddress } as const;
    try {
      await c.simulateContract(call);
      const gas = await c.estimateContractGas(call);
      return { ok: true, gas };
    } catch (e) {
      const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined;
      const msg = revert instanceof ContractFunctionRevertedError ? `${revert.data?.errorName ?? "revert"}(${(revert.data?.args ?? []).join(",")})` : (e as Error).message.split("\n")[0]!;
      return { ok: false, error: msg };
    }
  }

  async decide(raw: Proposal, readSet: Id16[], turn: Id16): Promise<Decision> {
    const decisionId = uuidv7();
    const proposal: PaymentProposal = {
      recipient: raw.recipient,
      amount: BigInt(raw.amount),
      token: raw.token,
      ...(raw.payeeLabel !== undefined ? { payeeLabel: raw.payeeLabel } : {}),
      ...(raw.reason !== undefined ? { reason: raw.reason } : {}),
      ...(raw.cites !== undefined ? { cites: raw.cites } : {}),
    };

    let verdict: Verdict;
    let txHash: Hex | undefined;
    let payError: string | undefined;
    let p: BuiltProjection | undefined;
    try {
      p = await this.o.control.refresh();
    } catch {
      p = undefined;
    }
    if (!p) {
      verdict = { decision: "BLOCK", code: "CHAIN_UNAVAILABLE", reasons: ["could not read and cross-check chain state"] };
    } else {
      // Every memory the model read must be verified and visible; anything else fails R0 (I-6).
      const contextVerified = readSet.every((id) => {
        const m = p!.projection.get(id);
        return !!m && m.cls !== "unverified" && !m.quarantined;
      });
      const { ledger, chain } = await this.ledgerState(p);
      const pre = checkRules(proposal, ledger, { ...chain, contextVerified });
      if (pre.decision === "ALLOW") {
        const simulation = await this.simulate(pre.call.payeeId, pre.call.token, pre.call.amount, decisionId);
        verdict = evaluatePayment(proposal, ledger, { ...chain, contextVerified, simulation });
      } else {
        verdict = pre;
      }
      if (verdict.decision === "ALLOW") {
        const req = { chainId: this.d.chainId, vault: this.d.guardedVault, payeeId: verdict.call.payeeId, token: verdict.call.token, amount: verdict.call.amount, decisionId };
        const controlSig = await this.o.controlKey.signMessage({ message: { raw: payRequestDigest(req) } });
        try {
          txHash = (await this.o.signer({ payeeId: req.payeeId, token: req.token, amount: req.amount.toString(), decisionId, controlSig })).txHash;
        } catch (e) {
          payError = (e as Error).message;
        }
      }
    }

    // Always write the decision: control lane, parents = readSet, same id the vault saw.
    const body = JSON.stringify({
      decisionId,
      turn,
      proposal: { ...raw },
      verdict: asJson(verdict),
      ...(txHash ? { txHash } : {}),
      ...(payError ? { payError } : {}),
    });
    const refBlock = await this.o.clients[0]!.getBlockNumber({ cacheTime: 0 });
    const blob = await signEnvelope(this.o.controlKey, anchorDomain(this.d), {
      id: decisionId,
      acct: this.d.acct,
      ns: "tyrell.control",
      lane: Lane.Control,
      kind: Kind.Decision,
      body,
      refBlock,
      parents: readSet,
      turn,
    });
    const anchored = await this.o.control.submit(blob);
    return { decisionId, verdict, ...(txHash ? { txHash } : {}), ...(payError ? { payError } : {}), anchored: { id: anchored.id, txHash: anchored.txHash } };
  }
}
