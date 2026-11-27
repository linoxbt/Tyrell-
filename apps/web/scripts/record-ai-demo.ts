/**
 * Records one real run of each preset attack for the playground's Live AI tab, so the page shows a real
 * model's behaviour even when live runs are off or rate-limited. Needs the model key:
 *   FORTYTWO_API_KEY=... pnpm record:ai          (or any LLM_* provider settings)
 */
import { writeFileSync } from "node:fs";
import { runDemo, type DemoResult } from "../lib/ai/demo";
import { SCENARIOS } from "../lib/ai/scenarios";
import { llmFromEnv, type LlmConfig } from "../lib/playground/vendor/llm";

const agent = llmFromEnv(process.env, "agent");
const judge = llmFromEnv(process.env, "judge");
if (!agent || !judge) {
  console.error(
    "set FORTYTWO_API_KEY (or LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)",
  );
  process.exit(1);
}
async function main(agent: LlmConfig, judge: LlmConfig) {
  const runs: Record<string, DemoResult> = {};
  for (const hijacked of [false, true])
for (const s of SCENARIOS) {
    const r = await runDemo(s, s.poison, { agent, judge }, { hijacked });
    const err = r.steward.error ?? r.unprotected.error;
    if (err) {
      console.error(`${s.id}: ${err}`);
      process.exit(1);
    }
    const verdicts =
      r.steward.proposals
        .map((p) => `${p.verdict?.decision} ${p.verdict?.code}`)
        .join(", ") || "no proposal";
    console.log(
      `${s.id}: judge ${r.judge.aiScore} (rules ${r.judge.rules.score}) · Tyrell: ${verdicts} · plain agent paid: ${r.unprotected.proposals.map((p) => p.recipient).join(", ") || "nobody"} · ${(r.ms / 1000).toFixed(1)}s`,
    );
    runs[`${s.id}${hijacked ? ":hijacked" : ""}`] = r;
    await new Promise((res) => setTimeout(res, 3000)); // stay well inside the provider's per-minute limit
  }
  const out = new URL("../public/ai-demo-recorded.json", import.meta.url);
  writeFileSync(
    out,
    `${JSON.stringify({ recordedAt: new Date().toISOString(), model: agent.model, provider: agent.provider, runs }, null, 2)}\n`,
  );
  console.log(
    `wrote apps/web/public/ai-demo-recorded.json (${agent.provider}, ${agent.model})`,
  );
}

void main(agent, judge);
