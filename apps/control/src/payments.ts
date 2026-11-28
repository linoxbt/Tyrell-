import { BaseError, ContractFunctionRevertedError, type Address, type Hex, type PublicClient } from "viem";
import type { LocalAccount } from "viem/accounts";
import {
  checkAgent,
  checkRules,
  codeText,
  evaluatePayment,
  Kind,
  Lane,
  MAX_PARENTS,
  PAY_REQUEST_TTL,
  payRequestDigest,
  signEnvelope,
  utcDay,
  uuidv7,
  type AgentCheck,
  type ChainState,
  type Id16,
  type LedgerState,
  type PayeeState,
  type PaymentProposal,
  type PayRequest,
  type Simulation,
  type Verdict,
} from "@tyrell/core";
import { agentRegistryAbi, guardedVaultAbi, laneRegistryAbi } from "@tyrell/chain";
import { CallFailed, RemoteError, type Proposal } from "@tyrell/ipc";
import { anchorDomain, type BuiltProjection } from "./projection.js";
import type { Control } from "./control.js";

/** A pay request as sent to the signer process: the exact call, signed by the control lane key. */
export interface SignedPayRequest {
  payeeId: Hex;
  token: Address;
  amount: string;
  decisionId: Id16;
  controlSig: Hex;
  /** Unix seconds; see PayRequest.deadline. */
  deadline: string;
  /** Agents network: present when this deployment is a registered agent (GuardedVault.payForAgent). */
  agentId?: string;
}

export type SignerTransport = (r: SignedPayRequest) => Promise<{ txHash: Hex }>;

/** What happened to an allowed payment. */
export type PayOutcome = { status: "paid"; txHash: Hex; payError?: undefined } | { status: "failed" | "unknown"; txHash?: Hex; payError: string };

/** An allowed decision with no settled outcome blocks further payments to its payee for this long. */
export const IN_FLIGHT_SECONDS = 600;
/** After a pay request's deadline, how long control keeps reading the chain for it. */
const SETTLE_GRACE_MS = 30_000;

export interface PaymentsOptions {
  control: Control;
  clients: PublicClient[];
  /** The control lane key: signs decision memories and pay requests. */
  controlKey: LocalAccount;
  /** The vault signer's public address, for R5 simulation. Its key lives only in the signer process. */
  signerAddress: Address;
  signer: SignerTransport;
  /** Tests: how long to wait for a pay receipt, and how often to poll the chain for a lost answer. */
  receiptTimeoutMs?: number;
  settlePollMs?: number;
  /** Tests: pay request lifetime (default PAY_REQUEST_TTL) and how long after it the chain is read. */
  payRequestTtl?: bigint;
  settleGraceMs?: number;
}

export interface Decision {
  decisionId: Id16;
  verdict: Verdict;
  /** For an ALLOW: what happened to the payment. */
  outcome?: PayOutcome["status"];
  txHash?: Hex;
  payError?: string;
  /** The decision memory's anchor (same id as decisionId), written before any payment. */
  anchored: { id: Id16; txHash: Hex };
  /** The control note recording the payment's outcome (parent: the decision). */
  outcomeRecord?: { id: Id16; txHash: Hex };
}

const asJson = (v: Verdict) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/**
 * The payment path (spec section 9): the model can only propose. Control evaluates R0-R5 on chain state
 * it read and cross-checked itself, simulates the exact vault call, writes a control-lane decision
 * memory whose parents are the turn's readSet (FR-11), and only then hands an ALLOW to the signer;
 * the payment's outcome is a second control record whose parent is the decision.
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

  /**
   * R4a (agents network): this deployment's agent must be the registered agent whose key is the active
   * agent-lane key, and AgentRegistry.check must accept the spend (live QIE ID binding, permissions,
   * delegated payee, agent limits, the human's shared quota). Read at `head` on two endpoints.
   */
  async agentCheck(head: bigint, payeeId: Hex, token: Address, amount: bigint): Promise<AgentCheck | undefined> {
    const registry = this.d.agentRegistry;
    const agentId = this.d.agentId;
    if (!registry || agentId === undefined) return undefined;
    const read = async (c: PublicClient) => {
      const [ok, code] = await c.readContract({ address: registry, abi: agentRegistryAbi, functionName: "check", args: [agentId, payeeId, token, amount], blockNumber: head });
      const a = await c.readContract({ address: registry, abi: agentRegistryAbi, functionName: "agent", args: [agentId], blockNumber: head });
      const laneKey = await c.readContract({ address: this.d.laneRegistry, abi: laneRegistryAbi, functionName: "activeKey", args: [2], blockNumber: head });
      return { ok, code: codeText(code), keyMatches: a.key.toLowerCase() === laneKey.toLowerCase() };
    };
    try {
      const [x, y] = await Promise.all([read(this.o.clients[0]!), read(this.o.clients[1] ?? this.o.clients[0]!)]);
      const verified = this.o.clients.length >= 2 && JSON.stringify(x) === JSON.stringify(y);
      if (!x.keyMatches) return { agentId, verified, ok: false, code: "AGENT_KEY_MISMATCH" };
      return { agentId, verified, ok: x.ok, code: x.code };
    } catch {
      return { agentId, verified: false, ok: false, code: "REGISTRY_UNAVAILABLE" };
    }
  }

  /** R5: eth_call and gas estimate of GuardedVault.pay (payForAgent for a registered agent) from the signer address. */
  async simulate(payeeId: Hex, token: Address, amount: bigint, decisionId: Id16): Promise<Simulation> {
    const c = this.o.clients[0]!;
    const agentId = this.d.agentRegistry ? this.d.agentId : undefined;
    const base = { address: this.d.guardedVault, abi: guardedVaultAbi, account: this.o.signerAddress } as const;
    try {
      let gas: bigint;
      if (agentId !== undefined) {
        const call = { ...base, functionName: "payForAgent", args: [agentId, payeeId, token, amount, decisionId] } as const;
        await c.simulateContract(call);
        gas = await c.estimateContractGas(call);
      } else {
        const call = { ...base, functionName: "pay", args: [payeeId, token, amount, decisionId] } as const;
        await c.simulateContract(call);
        gas = await c.estimateContractGas(call);
      }
      return { ok: true, gas };
    } catch (e) {
      const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined;
      const msg = revert instanceof ContractFunctionRevertedError ? `${revert.data?.errorName ?? "revert"}(${(revert.data?.args ?? []).join(",")})` : (e as Error).message.split("\n")[0]!;
      return { ok: false, error: msg };
    }
  }

  /**
   * A decision this control already allowed whose payment it cannot yet account for: no outcome record
   * and not used on-chain, written in the last IN_FLIGHT_SECONDS. While one exists for a payee, a new
   * payment to that payee is blocked, so a lost signer answer can never become a second payment (B-3).
   */
  private async inFlight(p: BuiltProjection, payeeId: Hex): Promise<Id16 | undefined> {
    const settled = new Set<string>();
    for (const m of p.projection.values()) {
      if (m.lane !== Lane.Control || m.kind !== Kind.Note || !m.body) continue;
      const b = parseJson(m.body);
      if (typeof b.outcomeOf === "string" && b.status !== "unknown") settled.add(b.outcomeOf.toLowerCase());
    }
    const now = Date.now();
    for (const m of p.projection.values()) {
      if (m.lane !== Lane.Control || m.kind !== Kind.Decision || !m.body || settled.has(m.id)) continue;
      const b = parseJson(m.body) as { verdict?: { decision?: string; payeeId?: string } };
      if (b.verdict?.decision !== "ALLOW" || b.verdict.payeeId?.toLowerCase() !== payeeId.toLowerCase()) continue;
      const ts = m.header?.ts ? Date.parse(m.header.ts) : NaN;
      if (Number.isFinite(ts) && now - ts > IN_FLIGHT_SECONDS * 1000) continue;
      const used = await this.o.clients[0]!.readContract({ address: this.d.guardedVault, abi: guardedVaultAbi, functionName: "decisionUsed", args: [m.id] }).catch(() => undefined);
      if (used === true) continue;
      return m.id;
    }
    return undefined;
  }

  /** The vault transaction that used `decisionId`, if any, searched from `fromBlock`. */
  private async paidTx(decisionId: Id16, fromBlock: bigint): Promise<Hex | undefined> {
    const c = this.o.clients[0]!;
    const used = await c.readContract({ address: this.d.guardedVault, abi: guardedVaultAbi, functionName: "decisionUsed", args: [decisionId] });
    if (!used) return undefined;
    const logs = await c.getContractEvents({ address: this.d.guardedVault, abi: guardedVaultAbi, fromBlock, toBlock: "latest" });
    const hit = logs.find((l) => {
      const a = l.args as { decisionId?: string };
      return typeof a.decisionId === "string" && a.decisionId.toLowerCase() === decisionId.toLowerCase();
    });
    return hit?.transactionHash ?? undefined;
  }

  /**
   * Hands an ALLOW to the signer and settles what happened, from the chain when the signer's answer
   * is lost: "paid" (with the transaction), "failed" (nothing was sent, or it reverted) or, only if
   * the chain cannot settle it, "unknown".
   */
  private async pay(req: PayRequest, fromBlock: bigint): Promise<PayOutcome> {
    const controlSig = await this.o.controlKey.signMessage({ message: { raw: payRequestDigest(req) } });
    const msg: SignedPayRequest = {
      payeeId: req.payeeId,
      token: req.token,
      amount: req.amount.toString(),
      decisionId: req.decisionId,
      controlSig,
      deadline: req.deadline.toString(),
      ...(req.agentId !== undefined ? { agentId: req.agentId.toString() } : {}),
    };
    let txHash: Hex | undefined;
    try {
      txHash = (await this.o.signer(msg)).txHash;
    } catch (e) {
      if (e instanceof RemoteError || (e instanceof CallFailed && !e.delivered)) return { status: "failed", payError: (e as Error).message };
      // The request reached the signer but its answer was lost: it may still be queued. The signer
      // drops a request after its deadline, so once that has passed the chain says what happened.
      const waitUntil = Number(req.deadline) * 1000 + (this.o.settleGraceMs ?? SETTLE_GRACE_MS);
      for (;;) {
        const tx = await this.paidTx(req.decisionId, fromBlock).catch(() => undefined);
        if (tx) return { status: "paid", txHash: tx };
        if (Date.now() > waitUntil) break;
        await new Promise((r) => setTimeout(r, this.o.settlePollMs ?? 2_000));
      }
      return { status: "failed", payError: `the signer did not answer (${(e as Error).message}) and the request expired unpaid` };
    }
    try {
      const receipt = await this.o.clients[0]!.waitForTransactionReceipt({ hash: txHash, timeout: this.o.receiptTimeoutMs ?? 120_000 });
      return receipt.status === "success" ? { status: "paid", txHash } : { status: "failed", txHash, payError: `pay transaction ${txHash} reverted` };
    } catch (e) {
      return { status: "unknown", txHash, payError: `no receipt yet: ${(e as Error).message.split("\n")[0]}` };
    }
  }

  /** Signs and anchors one control-lane record. */
  private async record(id: Id16, kind: Kind, parents: Id16[], turn: Id16, body: string) {
    const refBlock = await this.o.clients[0]!.getBlockNumber({ cacheTime: 0 });
    const blob = await signEnvelope(this.o.controlKey, anchorDomain(this.d), { id, acct: this.d.acct, ns: "tyrell.control", lane: Lane.Control, kind, body, refBlock, parents, turn });
    return this.o.control.submit(blob);
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
    let p: BuiltProjection | undefined;
    let agent: AgentCheck | undefined;
    if (readSet.length <= MAX_PARENTS) {
      try {
        p = await this.o.control.refresh();
      } catch {
        p = undefined;
      }
    }
    if (readSet.length > MAX_PARENTS) {
      // The decision's parents are the turn's readSet, and a record can have at most 64 parents. A turn
      // that read more could not be recorded faithfully, so it cannot pay (B-1, FR-11).
      verdict = { decision: "BLOCK", code: "LEDGER_UNVERIFIED", reasons: [`the turn read ${readSet.length} memories; a payment decision can cite at most ${MAX_PARENTS}`] };
    } else if (!p) {
      verdict = { decision: "BLOCK", code: "CHAIN_UNAVAILABLE", reasons: ["could not read and cross-check chain state"] };
    } else {
      // Every memory the model read must be verified and visible; anything else fails R0 (I-6).
      const contextVerified = readSet.every((id) => {
        const m = p!.projection.get(id);
        return !!m && m.cls !== "unverified" && !m.quarantined;
      });
      const { ledger, chain } = await this.ledgerState(p);
      const rules = checkRules(proposal, ledger, { ...chain, contextVerified });
      agent = rules.decision === "ALLOW" ? await this.agentCheck(p.head, rules.call.payeeId, rules.call.token, rules.call.amount) : undefined;
      const pre = checkAgent(rules, agent);
      if (pre.decision === "ALLOW") {
        const pending = await this.inFlight(p, pre.call.payeeId);
        if (pending) {
          verdict = { decision: "BLOCK", code: "LEDGER_UNVERIFIED", reasons: [`an earlier payment to this payee (decision ${pending}) has no settled outcome yet`], payeeId: pre.call.payeeId };
        } else {
          const simulation = await this.simulate(pre.call.payeeId, pre.call.token, pre.call.amount, decisionId);
          verdict = evaluatePayment(proposal, ledger, { ...chain, contextVerified, simulation }, agent);
        }
      } else {
        verdict = pre;
      }
    }

    // 1. The decision is written before anything is paid: control lane, parents = readSet, the same id
    //    the vault will see. If it cannot be recorded, nothing is paid (B-1).
    // A turn that read more than a record can cite is blocked above; its record cites the first
    // MAX_PARENTS and says how many there were.
    const parents = readSet.slice(0, MAX_PARENTS);
    const body = JSON.stringify({ decisionId, turn, proposal: { ...raw }, verdict: asJson(verdict), ...(readSet.length > MAX_PARENTS ? { readSetSize: readSet.length } : {}) });
    const anchored = await this.record(decisionId, Kind.Decision, parents, turn, body);

    if (verdict.decision !== "ALLOW") return { decisionId, verdict, anchored: { id: anchored.id, txHash: anchored.txHash } };

    // 2. Pay, then record the outcome as a control note whose parent is the decision.
    const req: PayRequest = {
      chainId: this.d.chainId,
      vault: this.d.guardedVault,
      payeeId: verdict.call.payeeId,
      token: verdict.call.token,
      amount: verdict.call.amount,
      decisionId,
      ...(agent ? { agentId: agent.agentId } : {}),
      deadline: BigInt(Math.floor(Date.now() / 1000)) + (this.o.payRequestTtl ?? PAY_REQUEST_TTL),
    };
    const outcome = await this.pay(req, anchored.block);
    let outcomeAnchored: Decision["outcomeRecord"];
    try {
      const o = await this.record(uuidv7(), Kind.Note, [decisionId], turn, JSON.stringify({ outcomeOf: decisionId, ...outcome }));
      outcomeAnchored = { id: o.id, txHash: o.txHash };
    } catch {
      // The decision is on record and the vault event carries its id; the outcome note is a convenience.
      outcomeAnchored = undefined;
    }
    return {
      decisionId,
      verdict,
      outcome: outcome.status,
      ...(outcome.status === "paid" ? { txHash: outcome.txHash } : {}),
      ...(outcome.payError ? { payError: outcome.payError } : {}),
      anchored: { id: anchored.id, txHash: anchored.txHash },
      ...(outcomeAnchored ? { outcomeRecord: outcomeAnchored } : {}),
    };
  }
}

const parseJson = (s: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
