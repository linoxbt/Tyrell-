import { NextResponse } from "next/server";
import { runDemo, type DemoResult } from "../../../../lib/ai/demo";
import { admitShared, cached, remember, sameOriginJson } from "../../../../lib/ai/guard";
import { CUSTOM_MAX, scenarioOf } from "../../../../lib/ai/scenarios";
import { llmFromEnv } from "../../../../lib/playground/vendor/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const config = () => {
  const agent = llmFromEnv(process.env, "agent");
  const judge = llmFromEnv(process.env, "judge");
  return agent && judge ? { agent, judge } : undefined;
};

/** Whether live runs are available, and on which model (never the key). */
export function GET() {
  const c = config();
  return NextResponse.json(c ? { live: true, provider: c.agent.provider, model: c.agent.model } : { live: false });
}

export async function POST(req: Request) {
  const c = config();
  if (!c) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const refused = sameOriginJson(req);
  if (refused) return NextResponse.json({ error: "forbidden", message: refused }, { status: 403 });
  let body: { scenario?: unknown; text?: unknown; hijacked?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const scenario = typeof body.scenario === "string" ? scenarioOf(body.scenario) : undefined;
  if (!scenario) return NextResponse.json({ error: "unknown_scenario" }, { status: 400 });
  let poison = scenario.poison;
  if (scenario.id === "custom") {
    poison = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
    if (!poison || poison.length > CUSTOM_MAX) return NextResponse.json({ error: `text must be 1 to ${CUSTOM_MAX} characters` }, { status: 400 });
  }

  const hijacked = body.hijacked === true;
  const key = `${scenario.id}:${hijacked}:${poison}`;
  const hit = scenario.id !== "custom" ? cached<DemoResult>(key) : undefined;
  if (hit) return NextResponse.json({ ...hit, cached: true });

  const visitor = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const gate = await admitShared(visitor);
  if (!gate.ok) return NextResponse.json({ error: "rate_limited", message: gate.reason, retryAfter: gate.retryAfter }, { status: 429, headers: { "retry-after": String(gate.retryAfter) } });

  const result = await runDemo(scenario, poison, c, { hijacked });
  // an agent that never got an answer (out of credits, rate limited, too slow) is not a result: the page
  // replays the recording instead of showing "the hacker got nothing" for a run that did not happen
  if (result.steward.error || result.unprotected.error) return NextResponse.json({ error: "model_failed", message: result.steward.error ?? result.unprotected.error }, { status: 502 });
  if (scenario.id !== "custom") remember(key, result);
  return NextResponse.json(result);
}
