import { encodeFunctionData, erc20Abi, formatUnits, isAddress, parseUnits, type Address, type PublicClient } from "viem";
import { z } from "zod";
import type { ChatModel, Message, ToolCall } from "./model.js";
import { TOOLS, UNPROTECTED_PROMPT } from "./prompt.js";
import type { PaymentToken } from "./runtime.js";

/** What the comparison agent "would have sent". It never signs: there is no key in this module. */
export interface WouldHaveSent {
  to: string;
  amount: string;
  token: string;
  simulated: "ok" | "reverted";
  detail?: string;
}

export interface UnprotectedOptions {
  model: ChatModel;
  /** Every memory, with no projection: quarantined and unverified ones included, no labels. */
  recallAll: (query: string) => Promise<string[]>;
  client: PublicClient;
  /** The plain wallet an unprotected agent would pay from (for the demo, the vault's balance). */
  wallet: Address;
  token: PaymentToken;
  maxSteps?: number;
}



const ProposeArgs = z.object({ recipient: z.string(), amount: z.string(), token: z.string(), payeeLabel: z.string().optional(), reason: z.string().optional(), cites: z.array(z.string()).optional() }).passthrough();

/**
 * The split-screen comparison (spec section 9, FR-16): the same model and the same memories with
 * Tyrell's projection and policy disabled, against a plain wallet instead of the vault. It builds the
 * ERC-20 transfer the model asks for and only simulates it with eth_call, so the demo can show
 * "would have sent N to 0x…" without any funds moving (T-18).
 */
export class UnprotectedSteward {
  constructor(private readonly o: UnprotectedOptions) {}

  async runTurn(task: string): Promise<{ wouldHaveSent: WouldHaveSent[]; final: string | null }> {
    const recalled = await this.o.recallAll(task);
    const messages: Message[] = [
      { role: "system", content: UNPROTECTED_PROMPT },
      { role: "user", content: `Task: ${task}\n\nMemories:\n${recalled.join("\n") || "(none)"}` },
    ];
    const sent: WouldHaveSent[] = [];
    let final: string | null = null;
    for (let step = 0; step < (this.o.maxSteps ?? 8); step++) {
      const reply = await this.o.model.complete(messages, TOOLS);
      messages.push({ role: "assistant", content: reply.content, ...(reply.toolCalls.length ? { tool_calls: reply.toolCalls } : {}) });
      if (!reply.toolCalls.length) {
        final = reply.content;
        break;
      }
      for (const call of reply.toolCalls) messages.push({ role: "tool", tool_call_id: call.id, content: await this.tool(call, sent) });
    }
    return { wouldHaveSent: sent, final };
  }

  private async tool(call: ToolCall, sent: WouldHaveSent[]): Promise<string> {
    let args: unknown;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      return "error: bad JSON";
    }
    if (call.name === "recall_memories") return (await this.o.recallAll(String((args as { query?: unknown }).query ?? ""))).join("\n") || "(none)";
    if (call.name === "write_note") return "saved";
    if (call.name !== "propose_payment") return `error: unknown tool ${call.name}`;
    const a = ProposeArgs.safeParse(args);
    if (!a.success || !isAddress(a.data.recipient)) return "error: bad arguments";
    const t = this.o.token;
    const amount = parseUnits(a.data.amount, t.decimals);
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [a.data.recipient, amount] });
    try {
      await this.o.client.call({ account: this.o.wallet, to: t.address, data });
      sent.push({ to: a.data.recipient, amount: formatUnits(amount, t.decimals), token: t.address, simulated: "ok" });
      return `would have sent ${formatUnits(amount, t.decimals)} to ${a.data.recipient} (simulated only)`;
    } catch (e) {
      sent.push({ to: a.data.recipient, amount: formatUnits(amount, t.decimals), token: t.address, simulated: "reverted", detail: (e as Error).message.split("\n")[0]! });
      return "transfer would revert";
    }
  }
}
