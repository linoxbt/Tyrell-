/**
 * Runs the repository's test suites and records the results for the playground's "Recorded runs" tab:
 * every TypeScript test (vitest, including the anvil end-to-end runs) and every Foundry test.
 *   pnpm report:tests      (needs anvil/forge from contracts/node_modules, like `pnpm test`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = join(root, "apps/web/public/test-report.json");
const sh = (cmd: string, args: string[], cwd = root) => spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0" } });

// ---- vitest
const tmp = join(mkdtempSync(join(tmpdir(), "tyrell-report-")), "vitest.json");
const v = sh(join(root, "node_modules/.bin/vitest"), ["run", "--reporter=json", `--outputFile=${tmp}`]);
const vj = JSON.parse(readFileSync(tmp, "utf8")) as {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: Array<{ name: string; assertionResults: Array<{ fullName: string; title: string; ancestorTitles: string[]; status: string; duration?: number }> }>;
};
const vitest = vj.testResults
  .map((f) => ({
    file: relative(root, f.name),
    tests: f.assertionResults.map((t) => ({ name: [...t.ancestorTitles, t.title].join(" › "), status: t.status === "passed" ? "pass" : t.status === "failed" ? "fail" : "skip", ms: Math.round(t.duration ?? 0) })),
  }))
  .sort((a, b) => a.file.localeCompare(b.file));

// ---- forge
const f = sh(join(root, "contracts/node_modules/.bin/forge"), ["test", "--json"], join(root, "contracts"));
const fjText = f.stdout.slice(f.stdout.indexOf("{"));
const fj = JSON.parse(fjText) as Record<string, { test_results: Record<string, { status: string; kind?: { Unit?: { gas: number }; Fuzz?: { runs: number; mean_gas: number }; Invariant?: { runs: number; calls: number } } }> }>;
const forge = Object.entries(fj)
  .map(([suite, r]) => ({
    suite: suite.replace(/^test\//, ""),
    tests: Object.entries(r.test_results).map(([name, t]) => ({
      name: name.replace(/\(\)$/, ""),
      status: t.status === "Success" ? "pass" : t.status === "Skipped" ? "skip" : "fail",
      ...(t.kind?.Unit ? { gas: t.kind.Unit.gas } : {}),
      ...(t.kind?.Fuzz ? { fuzzRuns: t.kind.Fuzz.runs } : {}),
      ...(t.kind?.Invariant ? { invariantRuns: t.kind.Invariant.runs } : {}),
    })),
  }))
  .sort((a, b) => a.suite.localeCompare(b.suite));

const commit = sh("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
const count = (xs: Array<{ tests: Array<{ status: string }> }>, s: string) => xs.reduce((n, x) => n + x.tests.filter((t) => t.status === s).length, 0);
const report = {
  generatedAt: new Date().toISOString(),
  commit,
  node: process.version,
  totals: {
    typescript: { passed: count(vitest, "pass"), failed: count(vitest, "fail"), skipped: count(vitest, "skip"), files: vitest.length },
    foundry: { passed: count(forge, "pass"), failed: count(forge, "fail"), skipped: count(forge, "skip"), suites: forge.length },
  },
  vitest,
  forge,
};
writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
console.log(`wrote ${relative(root, out)}: TypeScript ${report.totals.typescript.passed}/${vj.numTotalTests} · Foundry ${report.totals.foundry.passed}/${report.totals.foundry.passed + report.totals.foundry.failed}`);
if (v.status !== 0 || f.status !== 0) process.exit(1);
