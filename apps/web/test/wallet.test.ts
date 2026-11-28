import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { getAddress, type Address } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { laneRegistryAbi } from "@tyrell/chain";
import { startChainlab, type Chainlab } from "../../../test/support/anvil";
import { importAccount } from "../../cli/src/import";
import { ensureBuild, webEnv } from "./nextBuild";

/*
 * Wallet login and owner actions in a real browser, in both wallet modes:
 *  - "reown": Reown AppKit, the site's wallet connection (browser wallets need no relay, so no project id);
 *  - "injected": NEXT_PUBLIC_WALLET_MODE=injected, the plain browser-wallet picker.
 * A fresh anvil chain gets the same contract addresses as the demo snapshot, and a test wallet
 * announced over EIP-6963 as QIE Wallet forwards every request to anvil's unlocked owner account.
 */

const WEB = join(__dirname, "..");
const NEXT = join(WEB, "node_modules/.bin/next");
const MODES = {
  injected: { distDir: ".next-injected", env: { NEXT_PUBLIC_WALLET_MODE: "injected" } as Record<string, string> },
  reown: { distDir: ".next", env: {} as Record<string, string> },
} as const;
type Mode = keyof typeof MODES;

const servers: ChildProcess[] = [];
/** Optional screenshots for review: WEB_SCREENSHOT_DIR=/some/dir */
const shot = async (page: Page, name: string) => {
  if (!process.env.WEB_SCREENSHOT_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(process.env.WEB_SCREENSHOT_DIR, `${name}.png`), fullPage: true });
};
const urls: Partial<Record<Mode, string>> = {};

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

async function serve(mode: Mode): Promise<string> {
  const { distDir, env: extra } = MODES[mode];
  const env = webEnv(distDir, extra);
  await ensureBuild(distDir, env);
  const port = await freePort();
  servers.push(spawn(NEXT, ["start", "-p", String(port), "-H", "127.0.0.1"], { cwd: WEB, env, stdio: "ignore" }));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${url}/snapshot.json`)).ok) break;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return url;
}

beforeAll(async () => {
  urls.injected = await serve("injected");
  urls.reown = await serve("reown");
}, 600_000);

afterAll(() => servers.forEach((s) => s.kill("SIGTERM")));

/** Injected before any page script: an EIP-1193 wallet that relays to anvil through the test process. */
const WALLET = `(() => {
  let chainId = "0x7a69";
  const listeners = {};
  const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v));
  const ok = () => sessionStorage.getItem("mock-connected");
  const accounts = () => window.__rpc("eth_accounts", []).then((a) => a.slice(0, 1));
  const provider = {
    async request({ method, params }) {
      if (method === "eth_requestAccounts") { sessionStorage.setItem("mock-connected", "1"); const a = await accounts(); emit("accountsChanged", a); return a; }
      if (method === "eth_accounts") return ok() ? accounts() : [];
      if (method === "wallet_requestPermissions") { sessionStorage.setItem("mock-connected", "1"); return [{ parentCapability: "eth_accounts" }]; }
      if (method === "wallet_getPermissions") return ok() ? [{ parentCapability: "eth_accounts" }] : [];
      if (method === "wallet_revokePermissions") { sessionStorage.removeItem("mock-connected"); return null; }
      if (method === "eth_chainId") return chainId;
      if (method === "net_version") return String(parseInt(chainId, 16));
      if (method === "wallet_switchEthereumChain") {
        const want = params[0].chainId;
        if (want !== "0x7a69" && want !== "0x7c6") { const e = new Error("Unrecognized chain"); e.code = 4902; throw e; }
        chainId = want; emit("chainChanged", want); return null;
      }
      if (method === "wallet_addEthereumChain") return null;
      return window.__rpc(method, params || []);
    },
    on(e, f) { (listeners[e] = listeners[e] || []).push(f); },
    removeListener(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
  };
  const info = { uuid: "test-qie", name: "QIE Wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiM3YzVjZmYiLz48L3N2Zz4=", rdns: "me.qiewallet" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;

async function walletPage(lab: Chainlab): Promise<{ page: Page; close: () => Promise<void> }> {
  const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.exposeFunction("__rpc", async (method: string, params: unknown[]) => {
    const r = await fetch(lab.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = (await r.json()) as { result?: unknown; error?: { message: string; code: number } };
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
    return j.result;
  });
  await page.addInitScript(WALLET);
  return { page, close: () => browser.close() };
}

describe.each(Object.keys(MODES) as Mode[])("wallet login and the console (%s)", (mode) => {
  let lab: Chainlab;
  beforeAll(async () => {
    lab = await startChainlab();
  }, 120_000);
  afterAll(() => lab?.stop());

  const activeKey = (registry: Address, lane: number) => lab.pub.readContract({ address: registry, abi: laneRegistryAbi, functionName: "activeKey", args: [lane] });

  async function signIn(page: Page, url: string, owner: Address) {
    await page.goto(`${url}/start`, { waitUntil: "networkidle" });
    await page.getByText("QIE Wallet is installed in this browser.").waitFor();
    await page.locator("main").getByRole("button", { name: "Connect wallet" }).first().click();
    const sheet = page.getByRole("dialog", { name: "Wallet" });
    if (mode === "reown") {
      const modal = page.locator("w3m-modal");
      await modal.getByText("WalletConnect").first().waitFor({ timeout: 20_000 });
      expect(await modal.getByText("QIE Wallet", { exact: true }).count()).toBe(1);
      await modal.getByText("QIE Wallet", { exact: true }).click();
      await page.locator("header button", { hasText: `${owner.slice(0, 6)}…` }).first().waitFor({ timeout: 20_000 });
      await page.locator("w3m-modal.open").waitFor({ state: "detached", timeout: 10_000 }).catch(() => page.keyboard.press("Escape"));
      await page.locator("header button", { hasText: `${owner.slice(0, 6)}…` }).first().click();
    } else {
      await sheet.getByRole("button", { name: /QIE Wallet/ }).click();
    }
    await sheet.getByText("Not signed in").waitFor();
    if (mode === "reown") await sheet.getByText("Connected with Reown · WalletConnect").waitFor();
    await sheet.getByRole("button", { name: "Sign in with your wallet" }).click();
    await sheet.getByText("Signed in", { exact: true }).waitFor({ timeout: 15_000 });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tyrell.wallet.session") ?? "{}").address)).toBe(owner);
    await page.keyboard.press("Escape");
    await page.getByText(`Signed in as ${owner}.`).waitFor();
    await page.getByText("Create your Tyrell account").first().waitFor();
  }

  it("never shows sample data: the console opens your own account", async () => {
    const { page, close } = await walletPage(lab);
    try {
      await page.goto(`${urls[mode]!}/console`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Your Tyrell account" }).waitFor();
      expect(await page.getByText("Recorded demo").count()).toBe(0);
      expect(await page.getByRole("button", { name: "Lineage" }).count()).toBe(0);
    } finally {
      await close();
    }
  }, 60_000);

  if (mode === "injected")
    it("creates an account from the wallet, imports it with the CLI, and creates a lane key in the browser", async () => {
      const url = urls[mode]!;
      const owner = getAddress(lab.owner);
      const { page, close } = await walletPage(lab);
      const dir = mkdtempSync(join(tmpdir(), "tyrell-web-"));
      try {
        await signIn(page, url, owner);
        await page.goto(`${url}/console`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: /Create a new account/ }).waitFor();
        await shot(page, "console-start");
        await page.getByRole("button", { name: /Create a new account/ }).click();
        await page.getByLabel("Password (8 characters or more)").fill("correct horse battery");
        await page.getByLabel("Same password again").fill("correct horse battery");
        const dl = page.waitForEvent("download", { timeout: 120_000 });
        await page.getByRole("button", { name: "Create my account" }).click();
        const file = join(dir, "account.json");
        await (await dl).saveAs(file);
        await page.getByText("Your account is ready.", { exact: false }).waitFor({ timeout: 120_000 });
        await shot(page, "console-created");

        // the CLI sets this computer up from the downloaded file
        const prev = process.env.TYRELL_HOME;
        process.env.TYRELL_HOME = join(dir, "home");
        try {
          expect(() => importAccount(file, "wrong password")).toThrow("wrong password");
          const r = importAccount(file, "correct horse battery");
          expect(r.config.chainId).toBe(31337);
          const d = JSON.parse(readFileSync(r.deploymentFile, "utf8")) as { laneRegistry: Address; owner: Address };
          expect(getAddress(d.owner)).toBe(owner);
          expect(await activeKey(d.laneRegistry, 2)).toBe(r.addresses.agent);
          expect(await activeKey(d.laneRegistry, 4)).toBe(r.addresses.control);
          expect(existsSync(join(dir, "home", "keys", "data.json"))).toBe(true);
          expect(() => importAccount(file, "correct horse battery")).toThrow("already has keys");

          // the console reads the new account from the chain
          await page.getByRole("button", { name: "Open my account" }).click();
          await page.getByText("Lane keys", { exact: true }).first().waitFor();
          await page.getByText("4/4").waitFor({ timeout: 20_000 });
          await page.getByText("Finish setting up").waitFor();
          await shot(page, "console-overview");

          // lane keys: revoke the agent key, then create a new one in the browser
          await page.getByRole("button", { name: "Keys" }).click();
          const row = page.locator("li", { hasText: "Steward, the AI agent" });
          await row.getByRole("button", { name: "Revoke" }).click();
          await row.getByLabel("Reason").fill("e2e: rotate the agent");
          await row.getByRole("button", { name: "Revoke the agent key" }).click();
          await row.getByText("no active key").waitFor({ timeout: 20_000 });
          await row.getByRole("button", { name: "Add key" }).click();
          await shot(page, "console-keys-add");
          await row.getByLabel("Password to encrypt the key file").fill("correct horse battery");
          await row.getByLabel("Same password again").fill("correct horse battery");
          const keyDl = page.waitForEvent("download");
          await row.getByRole("button", { name: "Add the agent key" }).click();
          const keyFile = join(dir, "agent.json");
          await (await keyDl).saveAs(keyFile);
          await row.getByText("no active key").waitFor({ state: "detached", timeout: 20_000 });
          const ks = JSON.parse(readFileSync(keyFile, "utf8")) as { address: string; tyrell: { role: string } };
          expect(ks.tyrell.role).toBe("agent");
          expect(await activeKey(d.laneRegistry, 2)).toBe(getAddress(`0x${ks.address}`));
          expect(getAddress(`0x${ks.address}`)).not.toBe(r.addresses.agent);
        } finally {
          if (prev === undefined) delete process.env.TYRELL_HOME;
          else process.env.TYRELL_HOME = prev;
        }
      } finally {
        await close();
        rmSync(dir, { recursive: true, force: true });
      }
    }, 240_000);

  if (mode === "reown")
    it("opens an existing deployment and replaces a lane key with one from `tyrell setup keys`", async () => {
      const url = urls[mode]!;
      const owner = getAddress(lab.owner);
      const { page, close } = await walletPage(lab);
      try {
        await signIn(page, url, owner);
        await page.goto(`${url}/console`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: /Open an account I have/ }).click();
        await page.getByLabel("Deployment JSON").fill(JSON.stringify(lab.deployment, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
        await page.getByRole("button", { name: "Open", exact: true }).click();
        await page.getByText("Lane keys", { exact: true }).first().waitFor();
        await page.getByRole("button", { name: "Keys" }).click();
        await page.getByText("Role here:").locator("..").getByText("Owner", { exact: true }).waitFor({ timeout: 20_000 });
        const fresh = getAddress(`0x${"ab".repeat(20)}`);
        const row = page.locator("li", { hasText: "What arrives in your wallet" });
        await row.getByRole("button", { name: "Replace" }).click();
        await row.getByRole("button", { name: "Use a key I already have" }).click();
        await row.getByLabel(/Key address/).fill(fresh);
        await row.getByLabel("Reason").fill("e2e: new ingest machine");
        await row.getByRole("button", { name: "Replace the wallet key" }).click();
        await row.getByText(`${fresh.slice(0, 6)}…${fresh.slice(-4)}`).waitFor({ timeout: 20_000 });
        expect(await activeKey(lab.deployment.laneRegistry, 3)).toBe(fresh);
        expect(await activeKey(lab.deployment.laneRegistry, 1)).toBe(lab.lanes.user.address);
      } finally {
        await close();
      }
    }, 180_000);
});
