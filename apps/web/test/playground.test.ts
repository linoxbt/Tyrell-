import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOTAL, runSuite } from "../lib/playground/suite";

describe("playground", () => {
  it("its contract artifacts and pure-code copies match the repository (pnpm gen:playground --check)", () => {
    const root = join(__dirname, "../../..");
    const r = spawnSync(join(root, "node_modules/.bin/tsx"), ["scripts/gen-playground.ts", "--check"], { cwd: root, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });

  it("every live check passes in the in-browser EVM (run here in Node)", async () => {
    const r = await runSuite(() => undefined);
    const failed = r.results.filter((x) => x.status === "fail").map((x) => `${x.name}: ${x.error}`);
    expect(failed).toEqual([]);
    expect(r.results).toHaveLength(TOTAL);
    expect(TOTAL).toBeGreaterThanOrEqual(30);
  }, 60_000);
});
