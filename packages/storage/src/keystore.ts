import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { bytesToHex, hexToBytes, keccak256, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

/**
 * Web3 Secret Storage (keystore v3): scrypt + aes-128-ctr + keccak MAC. The same format Foundry
 * (`cast wallet import`, `forge script --account`) and most wallets read, so a Tyrell key file can
 * be used by the deploy script directly.
 *
 * Tyrell adds one optional field, `tyrell.role`, so a process can refuse a key file that is not its
 * own (I-12). The data key is stored the same way, with no address.
 */
export interface KeystoreV3 {
  version: 3;
  id: string;
  address?: string;
  crypto: {
    cipher: "aes-128-ctr";
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: "scrypt";
    kdfparams: { dklen: 32; n: number; r: number; p: number; salt: string };
    mac: string;
  };
  tyrell?: { role: string };
}

export interface EncryptOptions {
  role: string;
  /** EVM key: write its address. False for the data key. */
  evm: boolean;
  /** scrypt cost; 2^15 by default (about 32 MB, ~100 ms). Tests may lower it. */
  n?: number;
}

const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const scryptMem = (n: number, r: number) => 128 * r * n * 2;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  return scryptSync(Buffer.from(password.normalize("NFKC"), "utf8"), salt, 32, { N: n, r, p, maxmem: scryptMem(n, r) });
}

export function encryptKeystore(secret: Uint8Array, password: string, o: EncryptOptions): KeystoreV3 {
  if (secret.length !== 32) throw new Error("secret must be 32 bytes");
  if (password.length < 8) throw new Error("passphrase must be at least 8 characters");
  const n = o.n ?? 2 ** 15;
  const r = 8;
  const p = 1;
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const dk = derive(password, salt, n, r, p);
  const cipher = createCipheriv("aes-128-ctr", dk.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const mac = strip(keccak256(Buffer.concat([dk.subarray(16, 32), ciphertext])));
  dk.fill(0);
  return {
    version: 3,
    id: randomUUID(),
    ...(o.evm ? { address: strip(privateKeyToAddress(bytesToHex(secret))).toLowerCase() } : {}),
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ciphertext.toString("hex"),
      kdf: "scrypt",
      kdfparams: { dklen: 32, n, r, p, salt: salt.toString("hex") },
      mac,
    },
    tyrell: { role: o.role },
  };
}

export class KeystoreError extends Error {}

/** Decrypts a keystore. Errors never include key material. */
export function decryptKeystore(ks: KeystoreV3, password: string): Uint8Array {
  if (ks.version !== 3 || ks.crypto?.kdf !== "scrypt" || ks.crypto.cipher !== "aes-128-ctr") throw new KeystoreError("unsupported keystore");
  const { n, r, p, salt } = ks.crypto.kdfparams;
  const dk = derive(password, Buffer.from(salt, "hex"), n, r, p);
  const ciphertext = Buffer.from(ks.crypto.ciphertext, "hex");
  const mac = Buffer.from(strip(keccak256(Buffer.concat([dk.subarray(16, 32), ciphertext]))), "hex");
  const want = Buffer.from(ks.crypto.mac, "hex");
  if (mac.length !== want.length || !timingSafeEqual(mac, want)) {
    dk.fill(0);
    throw new KeystoreError("wrong passphrase or corrupted keystore");
  }
  const decipher = createDecipheriv("aes-128-ctr", dk.subarray(0, 16), Buffer.from(ks.crypto.cipherparams.iv, "hex"));
  const secret = new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  dk.fill(0);
  if (ks.address && strip(privateKeyToAddress(bytesToHex(secret))).toLowerCase() !== ks.address.toLowerCase()) {
    throw new KeystoreError("keystore address does not match its key");
  }
  return secret;
}

export function writeKeystore(path: string, ks: KeystoreV3): void {
  if (existsSync(path)) throw new KeystoreError(`refusing to overwrite ${path}`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(ks, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
}

export function readKeystore(path: string): KeystoreV3 {
  return JSON.parse(readFileSync(path, "utf8")) as KeystoreV3;
}

/**
 * Loads a key for `role`, refusing a file written for another role (I-12). Returns the secret as hex
 * for viem's privateKeyToAccount; callers must not log it.
 */
export function loadKey(path: string, password: string, role: string): Hex {
  const ks = readKeystore(path);
  if (ks.tyrell?.role !== role) throw new KeystoreError(`${path} holds the ${ks.tyrell?.role ?? "unknown"} key, not ${role}`);
  return bytesToHex(decryptKeystore(ks, password));
}

/** Public address of an EVM keystore, without decrypting it. */
export function keystoreAddress(path: string): Hex {
  const ks = readKeystore(path);
  if (!ks.address) throw new KeystoreError(`${path} is not an EVM key`);
  return `0x${ks.address}`;
}

export const newSecret = (): Uint8Array => new Uint8Array(randomBytes(32));
export const hexSecret = (h: Hex): Uint8Array => hexToBytes(h);
