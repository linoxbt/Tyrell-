import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { getAddress, zeroAddress, type Address } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { laneRegistryAbi } from "@tyrell/chain";
import { startChainlab, type Chainlab } from "../../../test/support/anvil";
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
const SNAPSHOT = join(WEB, "public/snapshot.json");
const MODES = {
  injected: { distDir: ".next-injected", env: { NEXT_PUBLIC_WALLET_MODE: "injected" } as Record<string, string> },
  reown: { distDir: ".next", env: {} as Record<string, string> },
} as const;
type Mode = keyof typeof MODES;

const servers: ChildProcess[] = [];
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
      if ((await fetch(`${url}/api/view`)).ok) break;
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

describe.each(Object.keys(MODES) as Mode[])("wallet login and owner actions (%s)", (mode) => {
  let lab: Chainlab;
  beforeAll(async () => {
    lab = await startChainlab();
  }, 120_000);
  afterAll(() => lab?.stop());

  it("connects QIE Wallet, signs in, reads the owner role and revokes a lane key on-chain", async () => {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { contracts: { memoryAnchor: string } };
    expect(snap.contracts.memoryAnchor.toLowerCase(), "snapshot contracts must match a fresh chainlab deployment").toBe(lab.deployment.memoryAnchor.toLowerCase());
    const url = urls[mode]!;
    const owner = getAddress(lab.owner);
    const { page, close } = await walletPage(lab);
    try {
      // the get-started checklist reacts to the wallet
      await page.goto(`${url}/start`, { waitUntil: "networkidle" });
      await page.getByText("QIE Wallet is installed in this browser.").waitFor();
      await page.locator("main").getByRole("button", { name: "Connect wallet" }).first().click();

      const sheet = page.getByRole("dialog", { name: "Wallet" });
      if (mode === "reown") {
        // Reown AppKit's modal: QIE Wallet is listed once, as installed
        const modal = page.locator("w3m-modal");
        await modal.getByText("WalletConnect").first().waitFor({ timeout: 20_000 });
        expect(await modal.getByText("QIE Wallet", { exact: true }).count()).toBe(1);
        await modal.getByText("QIE Wallet", { exact: true }).click();
        await page.locator("header").getByRole("button", { name: `Wallet ${owner.slice(0, 6)}…${owner.slice(-4)}` }).or(page.locator("header button", { hasText: `${owner.slice(0, 6)}…` })).first().waitFor({ timeout: 20_000 });
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
      expect(await page.locator("pre", { hasText: "--owner" }).innerText()).toContain(`--owner ${owner}`);

      // the console's Account tab: owner role, the four lane keys, and a revoke
      await page.goto(`${url}/console`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Account" }).click();
      await page.getByText("Role here:").waitFor({ timeout: 20_000 });
      const toLocal = page.getByRole("button", { name: "Switch wallet to Local chain (anvil)" });
      if (await toLocal.isVisible().catch(() => false)) await toLocal.click();
      await page.getByText("Role here:").locator("..").getByText("Owner", { exact: true }).waitFor({ timeout: 20_000 });
      const agent = lab.lanes.agent.address as Address;
      await page.getByText(`${agent.slice(0, 6)}…${agent.slice(-4)}`).waitFor();
      const agentRow = page.locator("li", { hasText: "agent" }).filter({ hasText: "Steward" });
      await agentRow.getByRole("button", { name: "Revoke" }).click();
      await agentRow.getByRole("textbox").fill(`e2e (${mode}): suspected compromise`);
      await agentRow.getByRole("button", { name: "Revoke the agent key" }).click();
      await agentRow.getByText("no active key").waitFor({ timeout: 20_000 });

      expect(await lab.pub.readContract({ address: lab.deployment.laneRegistry, abi: laneRegistryAbi, functionName: "activeKey", args: [2] })).toBe(zeroAddress);
      expect(await lab.pub.readContract({ address: lab.deployment.laneRegistry, abi: laneRegistryAbi, functionName: "activeKey", args: [1] })).toBe(lab.lanes.user.address);
    } finally {
      await close();
    }
  }, 180_000);
});
