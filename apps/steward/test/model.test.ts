import { describe, expect, it } from "vitest";
import { OpenAICompatibleModel } from "../src/model.js";
import { TOOLS } from "../src/runtime.js";

describe("OpenAI-compatible model client", () => {
  it("talks to Fortytwo's Qwen: bearer key, model id, tools, reasoning effort; reads tool calls back", async () => {
    let url = "";
    let init: { headers: Record<string, string>; body: string } | undefined;
    const f = (async (u: string, i: typeof init) => {
      url = u;
      init = i;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: null, reasoning: "the user fact names the landlord", tool_calls: [{ id: "c1", type: "function", function: { name: "propose_payment", arguments: '{"recipient":"0x1","amount":"5","token":"QUSDC","reason":"rent"}' } }] } }],
        }),
      );
    }) as unknown as typeof fetch;
    const m = new OpenAICompatibleModel({ baseURL: "https://api.fortytwo.network/v1/", apiKey: "sk-ft-v1-test", model: "qwen/qwen3.8-27b", reasoningEffort: "low", fetch: f });
    const r = await m.complete([{ role: "user", content: "pay rent" }], TOOLS);
    expect(url).toBe("https://api.fortytwo.network/v1/chat/completions");
    expect(init!.headers.authorization).toBe("Bearer sk-ft-v1-test");
    const body = JSON.parse(init!.body);
    expect(body).toMatchObject({ model: "qwen/qwen3.8-27b", temperature: 0, tool_choice: "auto", reasoning_effort: "low" });
    expect(body.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["recall_memories", "write_note", "propose_payment"]);
    expect(r.toolCalls).toEqual([{ id: "c1", name: "propose_payment", arguments: '{"recipient":"0x1","amount":"5","token":"QUSDC","reason":"rent"}' }]);
  });

  it("omits reasoning_effort for other providers and reports HTTP errors", async () => {
    let body: Record<string, unknown> = {};
    const ok = (async (_u: string, i: { body: string }) => ((body = JSON.parse(i.body)), new Response(JSON.stringify({ choices: [{ message: { content: "done" } }] })))) as unknown as typeof fetch;
    expect((await new OpenAICompatibleModel({ baseURL: "http://m", apiKey: "k", model: "x", fetch: ok }).complete([], [])).content).toBe("done");
    expect("reasoning_effort" in body).toBe(false);
    const bad = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    await expect(new OpenAICompatibleModel({ baseURL: "http://m", apiKey: "k", model: "x", fetch: bad }).complete([], [])).rejects.toThrow("HTTP 429");
  });
});
