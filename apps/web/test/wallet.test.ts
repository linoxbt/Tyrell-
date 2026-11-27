import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { getAddress, zeroAddress, type Address } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laneRegistryAbi } from "@tyrell/chain";
import { startChainlab, type Chainlab } from "../../../test/support/anvil";

/*
 * Wallet login and owner actions in a real browser. A fresh anvil chain gets the same contract
 * addresses as the demo snapshot, and a test wallet announced over EIP-6963 as QIE Wallet forwards
 * every request to anvil's unlocked owner account (anvil signs personal_sign and transactions).
 */

const WEB = join(__dirname, "..");
const SNAPSHOT = join(WEB, "public/snapshot.json");
let lab: Chainlab | undefined;
let server: ChildProcess | undefined;
let url = "";
let matches = false;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

beforeAll(async () => {
  lab = await startChainlab();
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { contracts: { memoryAnchor: string } };
  matches = snap.contracts.memoryAnchor.toLowerCase() === lab.deployment.memoryAnchor.toLowerCase();
  if (!existsSync(join(WEB, ".next/BUILD_ID"))) {
    const b = spawnSync(join(WEB, "node_modules/.bin/next"), ["build"], { cwd: WEB, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, encoding: "utf8" });
    if (b.status !== 0) throw new Error(b.stderr || b.stdout);
  }
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  delete env.TYRELL_API_URL;
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

afterAll(() => {
  server?.kill("SIGTERM");
  lab?.stop();
});

/** Injected before any page script: an EIP-1193 wallet that relays to anvil through the test process. */
const WALLET = `(() => {
  let chainId = "0x7a69";
  const listeners = {};
  const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v));
  const provider = {
    async request({ method, params }) {
      if (method === "eth_requestAccounts") { sessionStorage.setItem("mock-connected", "1"); return window.__rpc("eth_accounts", []).then((a) => a.slice(0, 1)); }
      if (method === "eth_accounts") return sessionStorage.getItem("mock-connected") ? window.__rpc("eth_accounts", []).then((a) => a.slice(0, 1)) : [];
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") {
        const want = params[0].chainId;
        if (want !== "0x7a69" && want !== "0x7c6") { const e = new Error("Unrecognized chain"); e.code = 4902; throw e; }
        chainId = want; emit("chainChanged", want); return null;
      }
      if (method === "wallet_addEthereumChain") return null;
      if (method === "wallet_revokePermissions") return null;
      if (method === "personal_sign") return window.__rpc("personal_sign", params);
      return window.__rpc(method, params || []);
    },
    on(e, f) { (listeners[e] = listeners[e] || []).push(f); },
    removeListener(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
  };
  const info = { uuid: "test-qie", name: "QIE Wallet", icon: "", rdns: "me.qiewallet" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;

describe("wallet login and owner actions", () => {
  it("connects QIE Wallet, signs in, reads the owner role and revokes a lane key on-chain", async () => {
    expect(matches, "snapshot contracts must match a fresh chainlab deployment").toBe(true);
    const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.exposeFunction("__rpc", async (method: string, params: unknown[]) => {
        const r = await fetch(lab!.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const j = (await r.json()) as { result?: unknown; error?: { message: string; code: number } };
        if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
        return j.result;
      });
      await page.addInitScript(WALLET);

      // the get-started checklist reacts to the wallet
      await page.goto(`${url}/start`, { waitUntil: "networkidle" });
      await page.getByText("QIE Wallet is installed in this browser.").waitFor();
      await page.locator("main").getByRole("button", { name: "Connect wallet" }).first().click();
      const sheet = page.getByRole("dialog", { name: "Wallet" });
      await sheet.getByRole("button", { name: /QIE Wallet/ }).click();
      await sheet.getByText("Not signed in").waitFor();
      await sheet.getByRole("button", { name: "Sign in with your wallet" }).click();
      await sheet.getByText("Signed in", { exact: true }).waitFor({ timeout: 15_000 });
      const owner = getAddress(lab!.owner);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tyrell.wallet.session") ?? "{}").address)).toBe(owner);
      await page.keyboard.press("Escape");
      await page.getByText(`Signed in as ${owner}.`).waitFor();
      await page.getByText("2 of 3 done").waitFor(); // a local chain is not QIE yet
      expect(await page.locator("pre", { hasText: "--owner" }).innerText()).toContain(`--owner ${owner}`);

      // the console's Account tab: owner role, the four lane keys, and a revoke
      await page.goto(`${url}/console`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Account" }).click();
      await page.getByText("Role here:").waitFor();
      await page.getByText("Role here:").locator("..").getByText("Owner", { exact: true }).waitFor({ timeout: 15_000 });
      const agent = lab!.lanes.agent.address as Address;
      await page.getByText(`${agent.slice(0, 6)}…${agent.slice(-4)}`).waitFor();
      const agentRow = page.locator("li", { hasText: "agent" }).filter({ hasText: "Steward" });
      await agentRow.getByRole("button", { name: "Revoke" }).click();
      await agentRow.getByRole("textbox").fill("e2e: suspected compromise");
      await agentRow.getByRole("button", { name: "Revoke the agent key" }).click();
      await agentRow.getByText("no active key").waitFor({ timeout: 20_000 });

      const active = await lab!.pub.readContract({ address: lab!.deployment.laneRegistry, abi: laneRegistryAbi, functionName: "activeKey", args: [2] });
      expect(active).toBe(zeroAddress);
      const user = await lab!.pub.readContract({ address: lab!.deployment.laneRegistry, abi: laneRegistryAbi, functionName: "activeKey", args: [1] });
      expect(user).toBe(lab!.lanes.user.address);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
