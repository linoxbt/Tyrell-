import { describe, expect, it } from "vitest";
import { LlmJudge } from "@tyrell/ingest";
import { sentinelJudge } from "../src/response.js";

describe("AI sentinel configuration", () => {
  it("is off without a model, prefers SENTINEL_LLM_*, falls back to LLM_*, and can be disabled", () => {
    expect(sentinelJudge({})).toBeUndefined();
    expect(sentinelJudge({ LLM_BASE_URL: "http://a", LLM_API_KEY: "k", LLM_MODEL: "m" })).toBeInstanceOf(LlmJudge);
    expect(sentinelJudge({ SENTINEL_LLM_BASE_URL: "http://b", SENTINEL_LLM_API_KEY: "k", SENTINEL_LLM_MODEL: "guard" })).toBeInstanceOf(LlmJudge);
    expect(sentinelJudge({ SENTINEL_AI: "off", LLM_BASE_URL: "http://a", LLM_API_KEY: "k", LLM_MODEL: "m" })).toBeUndefined();
  });
});
