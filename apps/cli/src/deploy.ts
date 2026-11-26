import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAddress, type Address } from "viem";
import { networks } from "@tyrell/chain";
import { home, paths, readConfig, writeConfig } from "./config.js";

export interface DeployOptions {
  /** The human's QIE Wallet address: owner of every contract and admin of the vault. */
  owner: Address;
  /** Foundry keystore name of a funded throwaway deployer (`cast wallet import <name> --interactive`). */
  account?: string;
  /** Local chains only: an unlocked node account (anvil) to deploy from. */
  unlockedSender?: Address;
  /** Payment token. Required on mainnet (QUSDC); unset elsewhere deploys TyrellTestUSD. */
  token?: Address;
  verify?: boolean;
  repoRoot?: string;
}

/**
 * Deploys the four contracts with contracts/script/Deploy.s.sol (FR-01). Roles go to the addresses
 * `tyrell setup keys` generated, so the deployer key holds nothing afterwards.
 */
export function deploy(o: DeployOptions): string {
  const c = readConfig();
  const root = resolve(o.repoRoot ?? process.env.TYRELL_REPO ?? join(import.meta.dirname, "../../.."));
  const contracts = join(root, "contracts");
  const addrs = JSON.parse(readFileSync(paths().addresses, "utf8")) as Record<string, Address>;
  if (c.network === "mainnet" && !o.token) throw new Error("--token (QUSDC) is required on mainnet");

  const args = ["script", "script/Deploy.s.sol", "--rpc-url", c.rpcs[0]!, "--broadcast"];
  if (o.unlockedSender) {
    if (c.network !== "local") throw new Error("--unlocked-sender is for local chains only");
    args.push("--unlocked", "--sender", o.unlockedSender);
  } else if (o.account) {
    args.push("--account", o.account);
  } else {
    throw new Error("pass --account <foundry keystore name>");
  }
  if (o.verify && c.network !== "local") {
    args.push("--verify", "--verifier", "blockscout", "--verifier-url", `${networks[c.network].explorer}/api/`);
  }
  const env = {
    ...process.env,
    OWNER: getAddress(o.owner),
    SUBMITTER: addrs.submitter!,
    VAULT_SIGNER: addrs.signer!,
    CONTROL: addrs.control!,
    TYRELL_ACCT: c.acct,
    ...(o.token ? { TOKEN: getAddress(o.token) } : {}),
  };
  const r = spawnSync(join(contracts, "node_modules/.bin/forge"), args, { cwd: contracts, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`forge script failed (exit ${r.status})`);

  const out = join(contracts, "deployments", `${c.chainId}.json`);
  if (!existsSync(out)) throw new Error(`forge did not write ${out}`);
  const dest = join(home(), `deployment-${c.chainId}.json`);
  copyFileSync(out, dest);
  writeConfig({ ...c, deploymentFile: dest });
  return dest;
}
