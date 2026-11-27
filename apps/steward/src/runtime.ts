import { parseUnits, type Address, type Hex } from "viem";
import type { LocalAccount } from "viem/accounts";
import { z } from "zod";
import { Kind, Lane, signEnvelope, uuidv7, type AnchorDomain, type Blob, type Id16 } from "@tyrell/core";
import type { ChatModel, Message, ToolCall } from "./model.js";
import { label, SYSTEM_PROMPT, TOOLS } from "./prompt.js";

/** What Steward may ask of control. Over IPC in production, in-process in tests. */
export interface ControlApi {
  recall(query: string, limit?: number): Promise<Array<{ id: string; cls: string; body: string }>>;
  submit(blob: Blob): Promise<{ id: Id16; txHash: Hex }>;
  propose(proposal: ProposalMsg, readSet: Id16[], turn: Id16): Promise<DecisionMsg>;
  head(): Promise<bigint>;
}

export interface ProposalMsg {
  recipient: string;
  amount: string;
  token: string;
  payeeLabel?: string;
  reason?: string;
  cites?: string[];
}

export interface DecisionMsg {
  decisionId: Id16;
  verdict: { decision: "ALLOW" | "BLOCK"; code: string; reasons: string[] };
  txHash?: Hex;
  payError?: string;
}

export interface PaymentToken {
  address: Address;
  decimals: number;
  /** Names the model may use for this token, e.g. ["QUSDC", "tUSD"]. Resolved by config, never by memory. */
  aliases: string[];
}

export interface StewardOptions {
  /** The agent lane key: the only key the Steward process holds (I-12). */
  agentKey: LocalAccount;
  acct: Hex;
  domain: AnchorDomain;
  control: ControlApi;
  model: ChatModel;
  token: PaymentToken;
  maxSteps?: number;
  recallLimit?: number;
}

export { LABELS, label, SYSTEM_PROMPT, TOOLS } from "./prompt.js";

const RecallArgs = z.object({ query: z.string().min(1).max(512), limit: z.number().int().min(1).max(16).optional() }).strict();
const NoteArgs = z.object({ text: z.string().min(1).max(4000), kind: z.enum(["note", "summary"]).optional(), cites: z.array(z.string()).max(32).optional() }).strict();
const ProposeArgs = z
  .object({
    recipient: z.string().max(128),
    amount: z.string().max(40),
    token: z.string().max(64),
    payeeLabel: z.string().max(64).optional(),
    reason: z.string().max(1024),
    cites: z.array(z.string().max(66)).max(32).optional(),
  })
  .strict();

export interface TurnResult {
  turn: Id16;
  readSet: Id16[];
  writes: Array<{ id: Id16; kind: "note" | "summary"; parents: Id16[] }>;
  decisions: DecisionMsg[];
  final: string | null;
  steps: number;
}

/**
 * One Steward turn (spec section 7, turn context). The runtime, not the model, decides lineage:
 *  - readSet = every memory placed in the prompt or returned by a tool during the turn;
 *  - every agent-lane write gets parents = readSet at the moment it is written;
 *  - citations the model offers are kept in the body for display and ignored for trust.
 * The model has no tool that writes through another lane or sends a transaction.
 */
export class Steward {
  constructor(private readonly o: StewardOptions) {}

  async runTurn(task: string): Promise<TurnResult> {
    const turn = uuidv7();
    const readSet = new Set<Id16>();
    const writes: TurnResult["writes"] = [];
    const decisions: DecisionMsg[] = [];

    const recall = async (query: string, limit?: number) => {
      const rows = await this.o.control.recall(query, limit ?? this.o.recallLimit ?? 8);
      for (const r of rows) readSet.add(r.id as Id16);
      return rows.map((r) => `${label(r.cls)} (${r.id}) ${r.body}`).join("\n") || "(no memories found)";
    };

    const messages: Message[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Task: ${task}\n\nRelevant memories:\n${await recall(task)}` },
    ];

    let final: string | null = null;
    let steps = 0;
    const max = this.o.maxSteps ?? 8;
    while (steps < max) {
      steps++;
      const reply = await this.o.model.complete(messages, TOOLS);
      messages.push({ role: "assistant", content: reply.content, ...(reply.toolCalls.length ? { tool_calls: reply.toolCalls } : {}) });
      if (reply.toolCalls.length === 0) {
        final = reply.content;
        break;
      }
      for (const call of reply.toolCalls) {
        const content = await this.tool(call, { turn, readSet, writes, decisions, recall });
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }
    return { turn, readSet: [...readSet].sort(), writes, decisions, final, steps };
  }

  private async tool(
    call: ToolCall,
    t: { turn: Id16; readSet: Set<Id16>; writes: TurnResult["writes"]; decisions: DecisionMsg[]; recall: (q: string, l?: number) => Promise<string> },
  ): Promise<string> {
    let args: unknown;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      return "error: arguments are not valid JSON";
    }
    switch (call.name) {
      case "recall_memories": {
        const a = RecallArgs.safeParse(args);
        if (!a.success) return `error: ${a.error.issues[0]?.message}`;
        return t.recall(a.data.query, a.data.limit);
      }
      case "write_note": {
        const a = NoteArgs.safeParse(args);
        if (!a.success) return `error: ${a.error.issues[0]?.message}`;
        const kind = a.data.kind === "summary" ? Kind.Summary : Kind.Note;
        const parents = [...t.readSet].sort();
        const body = JSON.stringify({ text: a.data.text, ...(a.data.cites?.length ? { cites: a.data.cites } : {}) });
        const blob = await signEnvelope(this.o.agentKey, this.o.domain, {
          acct: this.o.acct,
          lane: Lane.Agent,
          kind,
          body,
          refBlock: await this.o.control.head(),
          parents,
          turn: t.turn,
        });
        const out = await this.o.control.submit(blob);
        t.writes.push({ id: out.id, kind: a.data.kind ?? "note", parents });
        return `saved ${out.id}`;
      }
      case "propose_payment": {
        const a = ProposeArgs.safeParse(args);
        if (!a.success) return `error: ${a.error.issues[0]?.message}`;
        const tok = this.resolveToken(a.data.token);
        let amount: bigint;
        try {
          amount = parseUnits(a.data.amount.trim(), tok.decimals);
        } catch {
          return "error: amount must be a decimal number";
        }
        if (amount < 0n) return "error: amount must be positive";
        const proposal: ProposalMsg = {
          recipient: a.data.recipient.trim(),
          amount: amount.toString(),
          token: tok.address,
          ...(a.data.payeeLabel !== undefined ? { payeeLabel: a.data.payeeLabel } : {}),
          reason: a.data.reason,
          ...(a.data.cites ? { cites: a.data.cites } : {}),
        };
        const d = await this.o.control.propose(proposal, [...t.readSet].sort(), t.turn);
        t.decisions.push(d);
        return JSON.stringify({ decision: d.verdict.decision, code: d.verdict.code, reasons: d.verdict.reasons, ...(d.txHash ? { txHash: d.txHash } : {}), ...(d.payError ? { error: d.payError } : {}) });
      }
      default:
        return `error: unknown tool ${call.name}`;
    }
  }

  /** Token names resolve through config only. An unknown name passes through and fails R4 (ASSET_MISMATCH). */
  private resolveToken(s: string): { address: string; decimals: number } {
    const v = s.trim();
    const t = this.o.token;
    if (v.toLowerCase() === t.address.toLowerCase() || t.aliases.some((x) => x.toLowerCase() === v.toLowerCase())) return { address: t.address, decimals: t.decimals };
    return { address: v, decimals: t.decimals };
  }
}
