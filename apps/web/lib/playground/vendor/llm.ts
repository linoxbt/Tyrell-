// Copied verbatim from packages/core/src/llm.ts by scripts/gen-playground.ts. Do not edit: change the source and regenerate.
/**
 * Which language model Steward and the AI sentinel talk to. Any OpenAI-compatible chat completions
 * endpoint works; Fortytwo (Qwen) is built in, so FORTYTWO_API_KEY alone is enough.
 *
 *   agent (Steward):   LLM_PROVIDER, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_REASONING_EFFORT
 *   judge (sentinel):  the same names prefixed SENTINEL_, each falling back to the agent's
 *   Fortytwo:          FORTYTWO_API_KEY (or LLM_PROVIDER=fortytwo with LLM_API_KEY)
 *
 * The model is untrusted either way: guarantees never depend on which one is configured.
 */

export const FORTYTWO = {
  baseURL: "https://api.fortytwo.network/v1",
  model: "qwen/qwen3.8-27b",
} as const;

export type LlmRole = "agent" | "judge";

export interface LlmConfig {
  provider: "fortytwo" | "openai-compatible";
  baseURL: string;
  apiKey: string;
  model: string;
  /** Sent as reasoning_effort when set (Qwen on Fortytwo reasons by default; the judge needs a short answer). */
  reasoningEffort?: string;
}

/** Reasoning effort when Fortytwo is used and none is set: a quick agent turn, a judge that answers at once. */
const FORTYTWO_EFFORT: Record<LlmRole, string> = { agent: "low", judge: "none" };

export function llmFromEnv(env: Record<string, string | undefined>, role: LlmRole = "agent"): LlmConfig | undefined {
  const get = (k: string) => (role === "judge" ? (env[`SENTINEL_${k}`] ?? env[k]) : env[k]) || undefined;
  const baseURL = get("LLM_BASE_URL");
  const provider = get("LLM_PROVIDER");
  const fortytwo = provider === "fortytwo" || (!provider && !baseURL && !!env.FORTYTWO_API_KEY);
  const effort = get("LLM_REASONING_EFFORT");
  if (fortytwo) {
    const apiKey = get("LLM_API_KEY") ?? env.FORTYTWO_API_KEY;
    if (!apiKey) return undefined;
    return { provider: "fortytwo", baseURL: baseURL ?? FORTYTWO.baseURL, apiKey, model: get("LLM_MODEL") ?? FORTYTWO.model, reasoningEffort: effort ?? FORTYTWO_EFFORT[role] };
  }
  const apiKey = get("LLM_API_KEY");
  const model = get("LLM_MODEL");
  if (!baseURL || !apiKey || !model) return undefined;
  return { provider: "openai-compatible", baseURL, apiKey, model, ...(effort ? { reasoningEffort: effort } : {}) };
}
