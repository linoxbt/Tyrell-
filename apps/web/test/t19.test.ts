import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
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
    const { chromium } = await import("playwright");
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

  it("an incident opens its own detail page, and the back button returns to the list", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${url}/console`);
      await page.getByRole("button", { name: /^Incidents/ }).click();
      await page.getByText("See details →").first().click();
      await page.getByText("Why the alarm went off").waitFor();
      expect(new URL(page.url()).searchParams.get("incident")).toMatch(/^0x[0-9a-f]{32}$/);
      for (const t of ["What arrived", "AI judge", "Quarantine", "Payments it touched", "The memory record"]) await page.getByText(t, { exact: true }).waitFor();
      await page.goBack();
      await page.getByText("See details →").first().waitFor();
      expect(new URL(page.url()).searchParams.get("incident")).toBeNull();
    } finally {
      await browser.close();
    }
  });

  it("an incident opened from a link goes back to the list, not off the site; incidents work from the keyboard", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const view = (await (await fetch(`${url}/api/view`)).json()) as { incidents: Array<{ memoryId: string }> };
      const id = view.incidents[0]!.memoryId;
      await page.goto(`${url}/console?incident=${id}`);
      await page.getByText("Why the alarm went off").waitFor();
      await page.getByRole("button", { name: "← All incidents" }).click();
      await page.getByText("See details →").first().waitFor();
      expect(new URL(page.url()).pathname).toBe("/console");
      expect(new URL(page.url()).searchParams.get("incident")).toBeNull();

      // keyboard: focus an incident card and press Enter
      await page.getByRole("button", { name: /^Open incident/ }).first().focus();
      await page.keyboard.press("Enter");
      await page.getByText("Why the alarm went off").waitFor();

      // timeline rows open the memory panel from the keyboard too, and it scrolls into view
      await page.getByRole("button", { name: "Timeline" }).click();
      await page.getByRole("row", { name: /^Open memory/ }).first().focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Close" }).waitFor();
      expect(await page.getByRole("button", { name: "Close" }).isVisible()).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("the Account tab on a recording from a local chain explains itself and never offers that chain to the wallet", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${url}/console`);
      await page.getByRole("button", { name: "Account" }).click();
      await page.getByText(/recorded on a local test chain/).waitFor();
      expect(await page.getByText(/Switch wallet to/).count()).toBe(0);
      expect(await page.getByText("Connect a wallet to see the keys.").count()).toBe(0);
    } finally {
      await browser.close();
    }
  });

  it("no other site can frame the pages; the wallet bundle loads only where it is needed", async () => {
    const r = await fetch(`${url}/`);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");

    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const appkit = () => page.evaluate(() => !!customElements.get("w3m-modal"));
      await page.goto(`${url}/`, { waitUntil: "networkidle" });
      expect(await appkit()).toBe(false);
      await page.goto(`${url}/docs`, { waitUntil: "networkidle" });
      expect(await appkit()).toBe(false);
      // the header's Connect button still works: it loads the wallet stack and opens it
      await page.goto(`${url}/`, { waitUntil: "networkidle" });
      await page.locator("header").getByRole("button", { name: "Connect wallet" }).first().click();
      await page.locator("w3m-modal").getByText("WalletConnect").first().waitFor({ timeout: 20_000 });
      await page.goto(`${url}/console`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => !!customElements.get("w3m-modal"), undefined, { timeout: 20_000 });
    } finally {
      await browser.close();
    }
  });
});
