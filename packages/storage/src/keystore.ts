import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { bytesToHex, getAddress, hexToBytes, keccak256, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

/**
 * Web3 Secret Storage (keystore v3): scrypt + aes-128-ctr + keccak MAC. The same format Foundry
 * (`cast wallet import`, `forge script --account`) and most wallets read, so a Tyrell key file can
 * be used by the deploy script directly.
 *
 * Tyrell adds a `tyrell` field: `role`, so a process can refuse a key file that is not its own (I-12),
 * and `mac`, a second keccak MAC over the role and the ciphertext keyed by the same derived key. The
 * standard MAC still verifies, so Foundry and wallets read the file unchanged; the role MAC means the
 * role tag cannot be edited without the passphrase (a file relabelled "control" fails to load). Files
 * written before the role MAC are refused by `loadKey` until `tyrell keys migrate` adds it.
 * The data key is stored the same way, with no address.
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
  tyrell?: { role: string; /** keccak(dk[16:32] || "tyrell.role:" || role || 0x00 || ciphertext), hex. */ mac?: string };
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

/** Largest scrypt cost a keystore may ask for on read: a hostile file must not demand gigabytes. */
export const KDF_LIMITS = { maxN: 2 ** 18, maxR: 16, maxP: 4, maxMemBytes: 256 * 1024 * 1024 } as const;
/** Lowest scrypt cost `tyrell setup keys` accepts outside a local test chain. */
export const MIN_SCRYPT_N = 2 ** 14;

function checkKdf(n: unknown, r: unknown, p: unknown): void {
  const int = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x > 0;
  if (!int(n) || !int(r) || !int(p) || (n & (n - 1)) !== 0 || n < 2) throw new KeystoreError("invalid scrypt parameters");
  if (n > KDF_LIMITS.maxN || r > KDF_LIMITS.maxR || p > KDF_LIMITS.maxP || 128 * r * n > KDF_LIMITS.maxMemBytes) {
    throw new KeystoreError(`scrypt parameters too costly (n=${n}, r=${r}, p=${p}); refusing to derive`);
  }
}

const roleMac = (dk: Buffer, role: string, ciphertext: Buffer): string =>
  strip(keccak256(Buffer.concat([dk.subarray(16, 32), Buffer.from(`tyrell.role:${role}`, "utf8"), Buffer.from([0]), ciphertext])));

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  return scryptSync(Buffer.from(password.normalize("NFKC"), "utf8"), salt, 32, { N: n, r, p, maxmem: scryptMem(n, r) });
}

export function encryptKeystore(secret: Uint8Array, password: string, o: EncryptOptions): KeystoreV3 {
  if (secret.length !== 32) throw new Error("secret must be 32 bytes");
  if (password.length < 8) throw new Error("passphrase must be at least 8 characters");
  const n = o.n ?? 2 ** 15;
  const r = 8;
  const p = 1;
  checkKdf(n, r, p);
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const dk = derive(password, salt, n, r, p);
  const cipher = createCipheriv("aes-128-ctr", dk.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const mac = strip(keccak256(Buffer.concat([dk.subarray(16, 32), ciphertext])));
  const rmac = roleMac(dk, o.role, ciphertext);
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
    tyrell: { role: o.role, mac: rmac },
  };
}

export class KeystoreError extends Error {}

/**
 * Decrypts a keystore. Errors never include key material. With `role`, the file must carry a valid
 * role MAC for exactly that role (I-12); without it only the standard v3 MAC is checked.
 */
export function decryptKeystore(ks: KeystoreV3, password: string, role?: string): Uint8Array {
  if (ks.version !== 3 || ks.crypto?.kdf !== "scrypt" || ks.crypto.cipher !== "aes-128-ctr") throw new KeystoreError("unsupported keystore");
  const { n, r, p, salt } = ks.crypto.kdfparams;
  checkKdf(n, r, p);
  const dk = derive(password, Buffer.from(salt, "hex"), n, r, p);
  const ciphertext = Buffer.from(ks.crypto.ciphertext, "hex");
  const mac = Buffer.from(strip(keccak256(Buffer.concat([dk.subarray(16, 32), ciphertext]))), "hex");
  const want = Buffer.from(ks.crypto.mac, "hex");
  if (mac.length !== want.length || !timingSafeEqual(mac, want)) {
    dk.fill(0);
    throw new KeystoreError("wrong passphrase or corrupted keystore");
  }
  if (role !== undefined) {
    const have = ks.tyrell?.mac;
    const rm = Buffer.from(roleMac(dk, role, ciphertext), "hex");
    const got = typeof have === "string" && /^[0-9a-f]{64}$/i.test(have) ? Buffer.from(have, "hex") : undefined;
    if (!got || !timingSafeEqual(rm, got)) {
      dk.fill(0);
      throw new KeystoreError(
        got ? `the role tag of this keystore was changed: it was not written for ${role}` : "this keystore has no role MAC (written by an older Tyrell): run `tyrell keys migrate`",
      );
    }
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
  const text = readFileSync(path, "utf8");
  if (text.length > 16_384) throw new KeystoreError(`${path} is too large to be a keystore`);
  return JSON.parse(text) as KeystoreV3;
}

/**
 * Adds the role MAC to a keystore written before it existed (`tyrell keys migrate`). The standard MAC
 * and the address are checked first, so only the passphrase holder can migrate a file.
 */
export function migrateKeystore(ks: KeystoreV3, password: string, role: string): KeystoreV3 {
  if (ks.tyrell?.role !== role) throw new KeystoreError(`this file holds the ${ks.tyrell?.role ?? "unknown"} key, not ${role}`);
  const secret = decryptKeystore(ks, password);
  try {
    const { n, r, p, salt } = ks.crypto.kdfparams;
    const dk = derive(password, Buffer.from(salt, "hex"), n, r, p);
    const mac = roleMac(dk, role, Buffer.from(ks.crypto.ciphertext, "hex"));
    dk.fill(0);
    return { ...ks, tyrell: { role, mac } };
  } finally {
    secret.fill(0);
  }
}

/**
 * Loads a key for `role`, refusing a file written for another role (I-12). Returns the secret as hex
 * for viem's privateKeyToAccount; callers must not log it.
 */
export function loadKey(path: string, password: string, role: string): Hex {
  const ks = readKeystore(path);
  if (ks.tyrell?.role !== role) throw new KeystoreError(`${path} holds the ${ks.tyrell?.role ?? "unknown"} key, not ${role}`);
  return bytesToHex(decryptKeystore(ks, password, role));
}

/** Public address of an EVM keystore, without decrypting it. */
export function keystoreAddress(path: string): Hex {
  const ks = readKeystore(path);
  if (!ks.address) throw new KeystoreError(`${path} is not an EVM key`);
  return getAddress(`0x${ks.address}`);
}

export const newSecret = (): Uint8Array => new Uint8Array(randomBytes(32));
export const hexSecret = (h: Hex): Uint8Array => hexToBytes(h);
