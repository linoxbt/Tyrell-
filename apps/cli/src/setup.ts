import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { encodeFunctionData, erc20Abi, toHex, type Address, type Hex, type PublicClient } from "viem";
import { guardedVaultAbi, laneRegistryAbi, QIE_WALLET_RDNS, tyrellTestUSDAbi, type Deployment } from "@tyrell/chain";
import { encryptKeystore, keystoreAddress, newSecret, writeKeystore } from "@tyrell/storage";
import { defaultRpcs, home, paths, readConfig, ROLES, writeConfig, type TyrellConfig } from "./config.js";

export interface SetupKeysOptions {
  network: TyrellConfig["network"];
  chainId?: number;
  store?: TyrellConfig["store"];
  /** Create TYRELL_HOME/pass with a random passphrase if no passphrase file exists. */
  newPassphrase?: boolean;
  /** scrypt cost override (tests only). */
  scryptN?: number;
}

export interface SetupKeysResult {
  created: string[];
  existing: string[];
  addresses: Record<string, Address>;
  acct: Hex;
}

const LANE_ROLES = { 1: "user", 2: "agent", 3: "wallet", 4: "control" } as const;

/**
 * `tyrell setup keys` (FR-02): one encrypted keystore per role, each written once, never printed.
 * Writes TYRELL_HOME/keys/addresses.json with public addresses only.
 */
export function setupKeys(o: SetupKeysOptions, passphrase: () => string): SetupKeysResult {
  mkdirSync(paths().keys, { recursive: true, mode: 0o700 });
  const passFile = process.env.KEYSTORE_PASSPHRASE_FILE ?? `${home()}/pass`;
  if (!existsSync(passFile)) {
    if (!o.newPassphrase) throw new Error(`no passphrase file at ${passFile}: create one (chmod 600) or pass --new-passphrase`);
    writeFileSync(passFile, randomBytes(24).toString("base64url") + "\n", { mode: 0o600, flag: "wx" });
  }
  const pw = passphrase();
  const created: string[] = [];
  const existing: string[] = [];
  for (const role of ROLES) {
    const p = paths().key(role);
    if (existsSync(p)) {
      existing.push(role);
      continue;
    }
    writeKeystore(p, encryptKeystore(newSecret(), pw, { role, evm: role !== "data", ...(o.scryptN ? { n: o.scryptN } : {}) }));
    created.push(role);
  }
  const addresses = Object.fromEntries(ROLES.filter((r) => r !== "data").map((r) => [r, keystoreAddress(paths().key(r))])) as Record<string, Address>;
  writeFileSync(paths().addresses, JSON.stringify(addresses, null, 2) + "\n", { mode: 0o644 });

  let acct: Hex;
  let prev: TyrellConfig | undefined;
  try {
    prev = readConfig();
  } catch {
    prev = undefined;
  }
  if (prev) acct = prev.acct;
  else acct = toHex(randomBytes(32));
  const chainId = o.chainId ?? (o.network === "mainnet" ? 1990 : o.network === "testnet" ? 1983 : 31337);
  writeConfig({
    ...(prev ?? {}),
    network: o.network,
    chainId,
    rpcs: prev?.rpcs ?? defaultRpcs(o.network),
    acct,
    store: o.store ?? prev?.store ?? { kind: "dir", dir: paths().blobs },
  });
  return { created, existing, addresses, acct };
}

export interface OwnerTx {
  label: string;
  to: Address;
  data: Hex;
}

/** The owner transactions still missing: lane keys not yet active, and the vault's daily cap. */
export async function pendingOwnerTxs(
  c: PublicClient,
  d: Deployment,
  addresses: Record<string, Address>,
  dailyCap: bigint,
  /** Testnet only: top the vault up to this many TyrellTestUSD base units (the owner may mint them). */
  mintTestToken?: bigint,
): Promise<OwnerTx[]> {
  const txs: OwnerTx[] = [];
  for (const [lane, role] of Object.entries(LANE_ROLES)) {
    const want = addresses[role]!;
    const active = await c.readContract({ address: d.laneRegistry, abi: laneRegistryAbi, functionName: "activeKey", args: [Number(lane)] });
    if (active.toLowerCase() === want.toLowerCase()) continue;
    if (active !== "0x0000000000000000000000000000000000000000") throw new Error(`lane ${role} already has key ${active}: rotate it with \`tyrell revoke --rotate\``);
    txs.push({ label: `Register the ${role} lane key ${want}`, to: d.laneRegistry, data: encodeFunctionData({ abi: laneRegistryAbi, functionName: "addLaneKey", args: [Number(lane), want] }) });
  }
  const cap = await c.readContract({ address: d.guardedVault, abi: guardedVaultAbi, functionName: "globalDailyCap", args: [d.token] });
  if (cap !== dailyCap) {
    txs.push({ label: `Set the vault's daily cap to ${dailyCap} base units of ${d.token}`, to: d.guardedVault, data: encodeFunctionData({ abi: guardedVaultAbi, functionName: "setGlobalDailyCap", args: [d.token, dailyCap] }) });
  }
  if (mintTestToken) {
    const bal = await c.readContract({ address: d.token, abi: erc20Abi, functionName: "balanceOf", args: [d.guardedVault] });
    if (bal < mintTestToken) {
      txs.push({
        label: `Mint ${mintTestToken - bal} TyrellTestUSD base units into the vault (testnet only)`,
        to: d.token,
        data: encodeFunctionData({ abi: tyrellTestUSDAbi, functionName: "mint", args: [d.guardedVault, mintTestToken - bal] }),
      });
    }
  }
  return txs;
}

/**
 * Local page that connects QIE Wallet (EIP-6963, rdns me.qiewallet) and sends the owner transactions.
 * No key ever reaches the browser except the owner's own wallet. Calldata is prepared server-side.
 */
export function ownerPageHtml(o: { chainId: number; chainName: string; rpcUrls: string[]; explorer?: string; owner: Address; txs: OwnerTx[] }): string {
  const cfg = JSON.stringify({ ...o, chainIdHex: `0x${o.chainId.toString(16)}`, rdns: QIE_WALLET_RDNS }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Tyrell setup: owner transactions</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px}li{margin:6px 0}
code{font:13px ui-monospace,monospace}.ok{color:#1a7f37}.err{color:#cf222e}button{font:inherit;padding:8px 16px}</style></head>
<body><h1>Tyrell setup</h1>
<p>Sign these with the owner wallet <code id="owner"></code> on chain <code id="chain"></code>. Each is a separate transaction.</p>
<ol id="txs"></ol><button id="go">Connect QIE Wallet and send</button><p id="status"></p>
<script>
const cfg = ${cfg};
const $ = (id) => document.getElementById(id);
$("owner").textContent = cfg.owner; $("chain").textContent = cfg.chainName + " (" + cfg.chainId + ")";
cfg.txs.forEach((t, i) => { const li = document.createElement("li"); li.id = "tx" + i; li.textContent = t.label; $("txs").appendChild(li); });
async function discover() {
  const found = []; const on = (e) => found.push(e.detail);
  window.addEventListener("eip6963:announceProvider", on);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, 600));
  window.removeEventListener("eip6963:announceProvider", on);
  return found.find((p) => p.info.rdns === cfg.rdns)?.provider || window.qie;
}
$("go").onclick = async () => {
  const say = (m, cls) => { $("status").textContent = m; $("status").className = cls || ""; };
  try {
    const p = await discover();
    if (!p) return say("QIE Wallet not found. Install it, unlock it and reload.", "err");
    const [acct] = await p.request({ method: "eth_requestAccounts" });
    if (acct.toLowerCase() !== cfg.owner.toLowerCase()) return say("Connected " + acct + ", but the owner is " + cfg.owner + ". Switch account in the wallet.", "err");
    try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: cfg.chainIdHex }] }); }
    catch (e) {
      if (e && e.code === 4902) await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: cfg.chainIdHex, chainName: cfg.chainName,
        nativeCurrency: { name: "QIE", symbol: "QIEV3", decimals: 18 }, rpcUrls: cfg.rpcUrls, blockExplorerUrls: cfg.explorer ? [cfg.explorer] : [] }] });
      else throw e;
    }
    for (let i = 0; i < cfg.txs.length; i++) {
      say("Confirm transaction " + (i + 1) + " of " + cfg.txs.length + " in the wallet");
      const hash = await p.request({ method: "eth_sendTransaction", params: [{ from: acct, to: cfg.txs[i].to, data: cfg.txs[i].data }] });
      $("tx" + i).innerHTML += ' <span class="ok">sent</span> <code>' + hash + "</code>";
    }
    say("All sent. The terminal will confirm once they are mined.", "ok");
  } catch (e) { say("Stopped: " + (e && e.message ? e.message : e), "err"); }
};
</script></body></html>`;
}

/** Serves the owner page on 127.0.0.1 only. */
export function serveOwnerPage(html: string, port = 0): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    if (req.url !== "/" && req.url !== "/index.html") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" }).end(html);
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, server })),
  );
}
