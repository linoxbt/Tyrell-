import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { bytesToHex, getAddress, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { decryptKeystore, type KeystoreV3 } from "@tyrell/storage";
import { defaultRpcs, home, paths, ROLES, writeConfig, type Role, type TyrellConfig } from "./config.js";

/*
 * `tyrell import <account file>`: sets up this computer from the account file the web console downloads
 * when it creates an account. The file holds the seven keys (encrypted with the owner's password), the
 * account id and the contract addresses. Every key is decrypted once to check the password, its role tag
 * and its address; nothing is overwritten.
 */

export interface AccountFile {
  tyrell: "account-v1";
  network: TyrellConfig["network"];
  chainId: number;
  acct: Hex;
  deployment: Record<string, unknown>;
  addresses: Partial<Record<Role, Address>>;
  keys: Partial<Record<Role, KeystoreV3>>;
}

export function readAccountFile(file: string): AccountFile {
  const a = JSON.parse(readFileSync(file, "utf8")) as AccountFile;
  if (a.tyrell !== "account-v1") throw new Error(`${file} is not a Tyrell account file`);
  if (!["mainnet", "testnet", "local"].includes(a.network)) throw new Error(`unknown network "${a.network}"`);
  for (const r of ROLES) if (!a.keys?.[r]) throw new Error(`the account file has no ${r} key`);
  for (const k of ["laneRegistry", "memoryAnchor", "tyrellLedger", "guardedVault", "token", "owner"]) {
    const v = a.deployment?.[k];
    if (typeof v !== "string" || !isAddress(v)) throw new Error(`the account file has no valid ${k} address`);
  }
  return a;
}

export function importAccount(file: string, password: string): { addresses: Record<string, Address>; deploymentFile: string; config: TyrellConfig } {
  const a = readAccountFile(file);
  const taken = ROLES.filter((r) => existsSync(paths().key(r)));
  if (taken.length) throw new Error(`${home()} already has keys (${taken.join(", ")}): import into an empty TYRELL_HOME, or move them away first`);

  // check every key before writing anything
  const addresses: Record<string, Address> = {};
  for (const role of ROLES) {
    const ks = a.keys[role]!;
    if (ks.tyrell?.role !== role) throw new Error(`the ${role} key file is tagged "${ks.tyrell?.role}"`);
    let secret: Uint8Array;
    try {
      secret = decryptKeystore(ks, password);
    } catch {
      throw new Error("wrong password: it does not open the keys in this file");
    }
    if (role !== "data") {
      const addr = privateKeyToAddress(bytesToHex(secret));
      const claimed = a.addresses?.[role];
      if (claimed && getAddress(claimed) !== addr) throw new Error(`the ${role} key does not match its address`);
      addresses[role] = addr;
    }
    secret.fill(0);
  }

  mkdirSync(paths().keys, { recursive: true, mode: 0o700 });
  for (const role of ROLES) writeFileSync(paths().key(role), JSON.stringify(a.keys[role], null, 2) + "\n", { mode: 0o600, flag: "wx" });
  writeFileSync(paths().addresses, JSON.stringify(addresses, null, 2) + "\n", { mode: 0o644 });
  const passFile = process.env.KEYSTORE_PASSPHRASE_FILE ?? `${home()}/pass`;
  if (!existsSync(passFile)) writeFileSync(passFile, password + "\n", { mode: 0o600, flag: "wx" });
  const deploymentFile = `${home()}/deployment-${a.chainId}.json`;
  writeFileSync(deploymentFile, JSON.stringify({ ...a.deployment, chainId: a.chainId, acct: a.acct }, null, 2) + "\n");
  const config: TyrellConfig = { network: a.network, chainId: a.chainId, rpcs: defaultRpcs(a.network), acct: a.acct, store: { kind: "dir", dir: paths().blobs } };
  writeConfig(config);
  return { addresses, deploymentFile, config };
}

/** Reads a password from the terminal without echoing it. */
export function askPassword(prompt: string): Promise<string> {
  let muted = false;
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}
