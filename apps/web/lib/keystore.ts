import { scryptAsync } from "@noble/hashes/scrypt";
import { bytesToHex, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

/*
 * Keys created in the browser, in exactly the format the Tyrell processes read: Web3 Secret Storage
 * (keystore v3: scrypt + aes-128-ctr + keccak MAC) with Tyrell's `tyrell.role` tag and `tyrell.mac` role MAC
 * (keccak(dk[16:32] || "tyrell.role:" || role || 0x00 || ciphertext)), so a process refuses a file written for
 * another role and the tag cannot be edited without the password. Must match packages/storage/src/keystore.ts.
 * The secret never leaves this page unencrypted; the password is not stored.
 */

export type Role = "user" | "agent" | "wallet" | "control" | "submitter" | "signer" | "data";
export const LANE_ROLE: Record<number, Role> = { 1: "user", 2: "agent", 3: "wallet", 4: "control" };

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
  tyrell: { role: Role; mac: string };
}

const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

async function aesCtr(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CTR" }, false, ["encrypt"]);
  return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CTR", counter: iv as BufferSource, length: 64 }, k, data as BufferSource));
}

export async function encryptKeystore(secret: Uint8Array, password: string, role: Role, n = 2 ** 15): Promise<KeystoreV3> {
  if (secret.length !== 32) throw new Error("secret must be 32 bytes");
  if (password.length < 8) throw new Error("the password must be at least 8 characters");
  const salt = random(32);
  const iv = random(16);
  const dk = await scryptAsync(new TextEncoder().encode(password.normalize("NFKC")), salt, { N: n, r: 8, p: 1, dkLen: 32 });
  const ciphertext = await aesCtr(dk.subarray(0, 16), iv, secret);
  const macInput = new Uint8Array(16 + ciphertext.length);
  macInput.set(dk.subarray(16, 32));
  macInput.set(ciphertext, 16);
  const mac = strip(keccak256(macInput));
  const tag = new TextEncoder().encode(`tyrell.role:${role}`);
  const roleInput = new Uint8Array(16 + tag.length + 1 + ciphertext.length);
  roleInput.set(dk.subarray(16, 32));
  roleInput.set(tag, 16);
  roleInput.set(ciphertext, 16 + tag.length + 1);
  const roleMac = strip(keccak256(roleInput));
  dk.fill(0);
  return {
    version: 3,
    id: crypto.randomUUID(),
    ...(role !== "data" ? { address: strip(privateKeyToAddress(bytesToHex(secret))).toLowerCase() } : {}),
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: strip(toHex(iv)) },
      ciphertext: strip(toHex(ciphertext)),
      kdf: "scrypt",
      kdfparams: { dklen: 32, n, r: 8, p: 1, salt: strip(toHex(salt)) },
      mac,
    },
    tyrell: { role, mac: roleMac },
  };
}

/** A new key for `role`, encrypted with `password`. Returns its address (none for the data key). */
export async function createKey(role: Role, password: string, n?: number): Promise<{ address?: Address; keystore: KeystoreV3 }> {
  const secret = random(32);
  try {
    const keystore = await encryptKeystore(secret, password, role, n);
    return { ...(role !== "data" ? { address: privateKeyToAddress(bytesToHex(secret) as Hex) } : {}), keystore };
  } finally {
    secret.fill(0);
  }
}

/** Save a JSON file from the browser. */
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
