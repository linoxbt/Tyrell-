import { describe, expect, it } from "vitest";
import { FORTYTWO, llmFromEnv } from "../src/llm.js";

describe("model provider from the environment", () => {
  it("is off with nothing set", () => {
    expect(llmFromEnv({})).toBeUndefined();
    expect(llmFromEnv({}, "judge")).toBeUndefined();
  });

  it("FORTYTWO_API_KEY alone selects Fortytwo's Qwen, with a short-reasoning judge", () => {
    const env = { FORTYTWO_API_KEY: "sk-ft-v1-x" };
    expect(llmFromEnv(env)).toEqual({ provider: "fortytwo", baseURL: FORTYTWO.baseURL, apiKey: "sk-ft-v1-x", model: "qwen/qwen3.8-27b", reasoningEffort: "low" });
    expect(llmFromEnv(env, "judge")).toEqual({ provider: "fortytwo", baseURL: FORTYTWO.baseURL, apiKey: "sk-ft-v1-x", model: "qwen/qwen3.8-27b", reasoningEffort: "none" });
  });

  it("LLM_PROVIDER=fortytwo takes LLM_API_KEY, and every default can be overridden", () => {
    expect(llmFromEnv({ LLM_PROVIDER: "fortytwo" })).toBeUndefined();
    expect(llmFromEnv({ LLM_PROVIDER: "fortytwo", LLM_API_KEY: "k", LLM_MODEL: "deepseek/deepseek-v4.1-flash-1017", LLM_REASONING_EFFORT: "high", LLM_BASE_URL: "http://proxy/v1" })).toEqual({
      provider: "fortytwo",
      baseURL: "http://proxy/v1",
      apiKey: "k",
      model: "deepseek/deepseek-v4.1-flash-1017",
      reasoningEffort: "high",
    });
  });

  it("an explicit endpoint wins over FORTYTWO_API_KEY and needs all three values", () => {
    const env = { FORTYTWO_API_KEY: "f", LLM_BASE_URL: "http://other/v1", LLM_API_KEY: "o", LLM_MODEL: "m" };
    expect(llmFromEnv(env)).toEqual({ provider: "openai-compatible", baseURL: "http://other/v1", apiKey: "o", model: "m" });
    expect(llmFromEnv({ LLM_BASE_URL: "http://other/v1", LLM_API_KEY: "o" })).toBeUndefined();
    expect(llmFromEnv({ ...env, LLM_REASONING_EFFORT: "low" })?.reasoningEffort).toBe("low");
  });

  it("the judge's SENTINEL_ settings fall back to the agent's", () => {
    const env = { LLM_BASE_URL: "http://agent/v1", LLM_API_KEY: "a", LLM_MODEL: "big", SENTINEL_LLM_MODEL: "small" };
    expect(llmFromEnv(env, "judge")).toEqual({ provider: "openai-compatible", baseURL: "http://agent/v1", apiKey: "a", model: "small" });
    expect(llmFromEnv({ ...env, SENTINEL_LLM_PROVIDER: "fortytwo", SENTINEL_LLM_BASE_URL: "", FORTYTWO_API_KEY: "f" }, "judge")?.provider).toBe("fortytwo");
  });
});
