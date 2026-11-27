// Copied verbatim from apps/steward/src/model.ts by scripts/gen-playground.ts. Do not edit: change the source and regenerate.
/**
 * The language model is untrusted code (spec section 2, non-goals). Steward talks to any
 * OpenAI-compatible chat completions endpoint with tool calling; tests use a scripted model.
 */

export interface ToolCall {
  id: string;
  name: string;
  /** JSON string, as the model produced it. Parsed and validated by the runtime, never trusted. */
  arguments: string;
}

export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelReply {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface ChatModel {
  complete(messages: readonly Message[], tools: readonly ToolSpec[]): Promise<ModelReply>;
}

export interface OpenAICompatibleOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number;
  /** Sent as reasoning_effort when set (e.g. Qwen on Fortytwo). */
  reasoningEffort?: string;
  fetch?: typeof fetch;
}

/** Minimal OpenAI-compatible client (chat completions + tools). Temperature 0 by default (spec section 13). */
export class OpenAICompatibleModel implements ChatModel {
  constructor(private readonly o: OpenAICompatibleOptions) {}

  async complete(messages: readonly Message[], tools: readonly ToolSpec[]): Promise<ModelReply> {
    const f = this.o.fetch ?? fetch;
    const res = await f(`${this.o.baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.o.apiKey}` },
      body: JSON.stringify({
        model: this.o.model,
        temperature: this.o.temperature ?? 0,
        messages: messages.map((m) =>
          m.role === "assistant" && m.tool_calls?.length
            ? { role: "assistant", content: m.content, tool_calls: m.tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })) }
            : m,
        ),
        tools: tools.map((t) => ({ type: "function", function: t })),
        tool_choice: "auto",
        ...(this.o.reasoningEffort ? { reasoning_effort: this.o.reasoningEffort } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`model endpoint returned HTTP ${res.status}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    };
    const msg = body.choices?.[0]?.message;
    if (!msg) throw new Error("model endpoint returned no message");
    return {
      content: msg.content ?? null,
      toolCalls: (msg.tool_calls ?? []).map((t) => ({ id: t.id, name: t.function.name, arguments: t.function.arguments })),
    };
  }
}

/** A deterministic model for tests and demos: each step sees the conversation and returns a reply. */
export class ScriptedModel implements ChatModel {
  private step = 0;
  readonly seen: Message[][] = [];
  constructor(private readonly script: Array<(messages: readonly Message[]) => ModelReply>) {}
  async complete(messages: readonly Message[]): Promise<ModelReply> {
    this.seen.push([...messages]);
    const f = this.script[Math.min(this.step++, this.script.length - 1)]!;
    return f(messages);
  }
}

export const say = (content: string): ModelReply => ({ content, toolCalls: [] });
let callCounter = 0;
export const useTool = (name: string, args: Record<string, unknown>): ModelReply => ({
  content: null,
  toolCalls: [{ id: `call_${++callCounter}`, name, arguments: JSON.stringify(args) }],
});
