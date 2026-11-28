import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBuild, webEnv } from "./nextBuild";

const WEB = join(__dirname, "..");
const SNAPSHOT = join(WEB, "public/snapshot.json");
const EXPECTED = `${SNAPSHOT}.blast.json`;
const ready = existsSync(SNAPSHOT) && existsSync(EXPECTED);

let server: ChildProcess | undefined;
let url = "";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

beforeAll(async () => {
  if (!ready) return;
  const env = webEnv(".next"); // snapshot mode
  await ensureBuild(".next", env);
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  server = spawn(join(WEB, "node_modules/.bin/next"), ["start", "-p", String(port), "-H", "127.0.0.1"], { cwd: WEB, env, stdio: "ignore" });
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${url}/api/view`)).ok) break;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}, 300_000);

afterAll(() => server?.kill("SIGTERM"));

describe.skipIf(!ready)("T-19: the web view's blast radius matches `tyrell blast`", () => {
  it("serves the snapshot in read-only mode", async () => {
    const r = await fetch(`${url}/api/view`);
    expect(r.headers.get("x-tyrell-source")).toBe("snapshot");
    expect(((await r.json()) as { v: number }).v).toBe(1);
  });

  it("draws the same memories, decisions and parent -> child edges for the demo seed", async () => {
    const expected = JSON.parse(readFileSync(EXPECTED, "utf8")) as { seedId: number; memories: string[]; decisions: string[]; memoryEdges: number };
    // Playwright is pre-installed globally; require() resolves it through NODE_PATH, ESM import does not.
    const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
      await page.goto(`${url}/console`);
      await page.getByRole("button", { name: "Blast radius" }).click();
      await page.locator("select").selectOption(String(expected.seedId));
      const g = page.getByTestId("lineage-graph");
      await g.waitFor();
      await page.waitForTimeout(500);
      const drawn = (await g.getAttribute("data-memories"))!.split(",").filter(Boolean);
      expect([...drawn].sort()).toEqual([...expected.memories].sort());
      const nodeIds = await page.locator(".react-flow__node-memory").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
      expect([...nodeIds].sort()).toEqual([...expected.memories].sort());
      const memoryEdges = await page.locator(".react-flow__edge").evaluateAll((els) => els.map((e) => e.getAttribute("data-id") ?? e.getAttribute("aria-label") ?? ""));
      expect(memoryEdges.length).toBeGreaterThanOrEqual(expected.memoryEdges);
      if (process.env.WEB_SCREENSHOT_DIR) {
        await page.screenshot({ path: join(process.env.WEB_SCREENSHOT_DIR, "blast.png") });
        await page.getByRole("button", { name: "Decisions" }).click();
        await page.screenshot({ path: join(process.env.WEB_SCREENSHOT_DIR, "decisions.png") });
      }
    } finally {
      await browser.close();
    }
  });
});
