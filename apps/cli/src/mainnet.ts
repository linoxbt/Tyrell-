import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWalletClient, erc20Abi, formatUnits, http, keccak256, parseUnits, toBytes, type Address, type Hex } from "viem";
import { uuidv7 } from "@tyrell/core";
import { guardedVaultAbi, memoryAnchorAbi, networks, readLedger, tyrellLedgerAbi } from "@tyrell/chain";
import { chainFor } from "@tyrell/control";
import { account, clients, deployment, home, readConfig } from "./config.js";

/**
 * NFR-08: the most the vault can lose in one UTC day, whatever happens to every key but the owner's,
 * is min(vault-wide daily cap, sum of active payees' daily caps), and that goes only to registered payees.
 */
export async function capsCheck(maxUnits = "20") {
  const c = readConfig();
  const d = deployment(c);
  const pub = clients(c)[0]!;
  const head = await pub.getBlockNumber({ cacheTime: 0 });
  const { payees } = await readLedger(pub, d, head);
  const [decimals, symbol, balance, globalCap] = await Promise.all([
    pub.readContract({ address: d.token, abi: erc20Abi, functionName: "decimals" }),
    pub.readContract({ address: d.token, abi: erc20Abi, functionName: "symbol" }),
    pub.readContract({ address: d.token, abi: erc20Abi, functionName: "balanceOf", args: [d.guardedVault] }),
    pub.readContract({ address: d.guardedVault, abi: guardedVaultAbi, functionName: "globalDailyCap", args: [d.token] }),
  ]);
  const active = payees.filter((p) => p.active && !p.suspended && p.token.toLowerCase() === d.token.toLowerCase());
  const sumDaily = active.reduce((a, p) => a + p.capPerDay, 0n);
  const worst = [globalCap, sumDaily, balance].reduce((a, b) => (b < a ? b : a));
  const limit = parseUnits(maxUnits, decimals);
  const fmt = (x: bigint) => `${formatUnits(x, decimals)} ${symbol}`;
  return {
    token: d.token,
    vaultBalance: fmt(balance),
    vaultDailyCap: fmt(globalCap),
    payeeDailyCaps: active.map((p) => ({ label: p.label, addr: p.addr, capPerTx: fmt(p.capPerTx), capPerDay: fmt(p.capPerDay) })),
    worstCaseDailyLoss: fmt(worst),
    limit: fmt(limit),
    ok: worst <= limit,
  };
}

const evidenceFile = () => join(home(), "evidence.json");
const saveEvidence = (k: string, v: unknown) => {
  const e = existsSync(evidenceFile()) ? (JSON.parse(readFileSync(evidenceFile(), "utf8")) as Record<string, unknown>) : {};
  e[k] = v;
  writeFileSync(evidenceFile(), JSON.stringify(e, null, 2) + "\n");
};

/**
 * Demo 2:10-2:35, signer-key leak drill: the vault signer key itself sends `pay` to an unregistered
 * recipient, with a fixed gas limit so the transaction is broadcast and reverts on-chain (I-5).
 * Runs as the signer process: it loads only the signer key.
 */
export async function signerLeakDrill(amount = "1") {
  const c = readConfig();
  const d = deployment(c);
  const pub = clients(c)[0]!;
  const key = account("signer", "signer");
  const decimals = await pub.readContract({ address: d.token, abi: erc20Abi, functionName: "decimals" });
  const wallet = createWalletClient({ account: key, chain: chainFor(d.chainId, c.rpcs[0]!), transport: http(c.rpcs[0]!) });
  const fakePayee = keccak256(toBytes("payee:attacker"));
  const hash = await wallet.writeContract({
    address: d.guardedVault,
    abi: guardedVaultAbi,
    functionName: "pay",
    args: [fakePayee, d.token, parseUnits(amount, decimals), uuidv7()],
    gas: 200_000n,
    chain: wallet.chain,
    account: key,
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  const out = { txHash: hash, status: r.status, block: r.blockNumber.toString(), note: "signer key paid an unregistered payee directly: the vault reverted it" };
  saveEvidence("revertedUnauthorizedPay", out);
  return out;
}

/** Example transactions for the submission checklist (spec section 19), with explorer links. */
export async function evidence() {
  const c = readConfig();
  const d = deployment(c);
  const pub = clients(c)[0]!;
  const head = await pub.getBlockNumber({ cacheTime: 0 });
  const explorer = c.network === "local" ? undefined : networks[c.network].explorer;
  const link = (h?: Hex) => (h && explorer ? `${explorer}/tx/${h}` : h);
  const last = async (address: Address, abi: readonly unknown[], eventName: string) => {
    for (let to = head; to >= d.startBlock; to -= 5_000n) {
      const from = to - 4_999n > d.startBlock ? to - 4_999n : d.startBlock;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logs = await pub.getContractEvents({ address, abi: abi as any, eventName: eventName as any, fromBlock: from, toBlock: to });
      if (logs.length) return logs.at(-1)!.transactionHash as Hex;
      if (from === d.startBlock) break;
    }
    return undefined;
  };
  const [anchored, seeded, paid] = await Promise.all([
    last(d.memoryAnchor, memoryAnchorAbi, "MemoryAnchored"),
    last(d.tyrellLedger, tyrellLedgerAbi, "QuarantineSeeded"),
    last(d.guardedVault, guardedVaultAbi, "Paid"),
  ]);
  const saved = existsSync(evidenceFile()) ? (JSON.parse(readFileSync(evidenceFile(), "utf8")) as { revertedUnauthorizedPay?: { txHash: Hex } }) : {};
  return {
    contracts: Object.fromEntries(
      (["laneRegistry", "memoryAnchor", "tyrellLedger", "guardedVault", "token"] as const).map((k) => [k, explorer ? `${explorer}/address/${d[k]}` : d[k]]),
    ),
    transactions: {
      MemoryAnchored: link(anchored) ?? "none yet",
      QuarantineSeeded: link(seeded) ?? "none yet",
      Paid: link(paid) ?? "none yet",
      revertedUnauthorizedPay: link(saved.revertedUnauthorizedPay?.txHash) ?? "run `tyrell drill signer-leak`",
    },
  };
}
