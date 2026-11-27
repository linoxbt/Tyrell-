/**
 * Packs what the web playground runs in the visitor's browser:
 *  - the compiled contracts (ABI + bytecode) from contracts/out, unchanged;
 *  - verbatim copies of the pure policy engine and sentinel scorer;
 *  - for the live AI demo (server side): Steward's prompt, tools and model client, the AI judge, and the
 *    model-provider resolver (Fortytwo's Qwen built in), so the demo runs what the processes run.
 * The web app deploys on its own, so these are copied in rather than imported across the workspace.
 *   pnpm gen:playground            write
 *   pnpm gen:playground --check    exit 1 if anything is out of date (run by the test suite)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const out = new URL("apps/web/lib/playground/", root);
const check = process.argv.includes("--check");
const CONTRACTS = ["LaneRegistry", "MemoryAnchor", "TyrellLedger", "GuardedVault", "TyrellTestUSD", "TestQieId", "AgentRegistry", "AgentNetwork"];

const files: Record<string, string> = {};

const arts: Record<string, { abi: unknown; bytecode: string }> = {};
for (const name of CONTRACTS) {
  const a = JSON.parse(readFileSync(new URL(`contracts/out/${name}.sol/${name}.json`, root), "utf8"));
  arts[name] = { abi: a.abi, bytecode: a.bytecode.object };
}
files["artifacts.json"] = `${JSON.stringify(arts)}\n`;

const banner = (src: string) => `// Copied verbatim from ${src} by scripts/gen-playground.ts. Do not edit: change the source and regenerate.\n`;
const policy = readFileSync(new URL("packages/core/src/policy.ts", root), "utf8").replace(
  'import type { PayeeRecord } from "./digest.js";',
  "export interface PayeeRecord {\n  payeeId: Hex;\n  addr: Address;\n  token: Address;\n  capPerTx: bigint;\n  capPerDay: bigint;\n  label: string;\n  active: boolean;\n  suspended: boolean;\n}",
);
if (!policy.includes("export interface PayeeRecord")) throw new Error("policy.ts import changed: update gen-playground.ts");
files["vendor/policy.ts"] = banner("packages/core/src/policy.ts") + policy;
files["vendor/score.ts"] = banner("apps/ingest/src/score.ts") + readFileSync(new URL("apps/ingest/src/score.ts", root), "utf8");
const copy = (src: string, dest: string, fix: (s: string) => string = (x) => x) => {
  const body = readFileSync(new URL(src, root), "utf8");
  const fixed = fix(body);
  if (/^import (?!type )/m.test(fixed)) throw new Error(`${src} gained a runtime import: the web app cannot vendor it`);
  files[dest] = banner(src) + fixed;
};
copy("packages/core/src/llm.ts", "vendor/llm.ts");
copy("apps/steward/src/model.ts", "vendor/model.ts");
copy("apps/steward/src/prompt.ts", "vendor/prompt.ts", (x) => x.replace('from "./model.js";', 'from "./model";'));
copy("apps/ingest/src/judge.ts", "vendor/judge.ts");

let stale = 0;
for (const [rel, body] of Object.entries(files)) {
  const url = new URL(rel, out);
  const current = existsSync(url) ? readFileSync(url, "utf8") : "";
  if (current === body) continue;
  stale++;
  if (check) {
    console.error(`out of date: apps/web/lib/playground/${rel}`);
  } else {
    mkdirSync(new URL(".", url), { recursive: true });
    writeFileSync(url, body);
    console.log(`wrote apps/web/lib/playground/${rel}`);
  }
}
if (check && stale) {
  console.error("run `pnpm gen:playground`");
  process.exit(1);
}
if (!stale) console.log("playground artifacts are up to date");
