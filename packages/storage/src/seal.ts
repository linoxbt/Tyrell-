import { webcrypto } from "node:crypto";
import { concat, hexToBytes, toBytes, type Hex } from "viem";

const subtle = webcrypto.subtle;
const IV_BYTES = 12;

export type DataKey = webcrypto.CryptoKey;

/** Imports the 32-byte data key for AES-256-GCM. Not extractable once imported. */
export async function importDataKey(raw: Uint8Array): Promise<DataKey> {
  if (raw.length !== 32) throw new Error("data key must be 32 bytes");
  return subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Additional authenticated data: the account and memory id, so a blob cannot be replayed under another id. */
const aadOf = (acct: Hex, id: Hex): Uint8Array => concat([hexToBytes(acct), hexToBytes(id)]);

/**
 * Encrypts a memory blob (header, body, signature) with AES-256-GCM and a random 96-bit nonce
 * (spec section 13). Output: nonce || ciphertext+tag. IPFS only ever sees this (NFR-06).
 */
export async function sealBlob(key: DataKey, acct: Hex, id: Hex, blob: unknown): Promise<Uint8Array> {
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES));
  const pt = toBytes(JSON.stringify(blob));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadOf(acct, id) }, key, pt));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return out;
}

export class DecryptError extends Error {}

/** Decrypts and parses a sealed blob. Throws DecryptError on a wrong key, wrong id or tampering. */
export async function openBlob(key: DataKey, acct: Hex, id: Hex, sealed: Uint8Array): Promise<unknown> {
  if (sealed.length <= IV_BYTES + 16) throw new DecryptError("sealed blob too short");
  let pt: ArrayBuffer;
  try {
    pt = await subtle.decrypt(
      { name: "AES-GCM", iv: sealed.subarray(0, IV_BYTES), additionalData: aadOf(acct, id) },
      key,
      sealed.subarray(IV_BYTES),
    );
  } catch {
    throw new DecryptError("authentication failed");
  }
  try {
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    throw new DecryptError("plaintext is not JSON");
  }
}
