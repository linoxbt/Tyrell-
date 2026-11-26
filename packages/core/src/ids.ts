import { webcrypto } from "node:crypto";
import type { Hex } from "viem";

/** A 16-byte ID as 0x-prefixed lowercase hex. */
export type Id16 = Hex;

export const ZERO_ID16: Id16 = `0x${"00".repeat(16)}`;
const ID16_RE = /^0x[0-9a-f]{32}$/;
export const isId16 = (v: unknown): v is Id16 => typeof v === "string" && ID16_RE.test(v);

/**
 * UUIDv7 (RFC 9562): 48-bit Unix ms timestamp, version 7, variant 10, random rest.
 * Time-ordered, so memory IDs sort roughly by creation time.
 */
export function uuidv7(nowMs: number = Date.now(), rand: Uint8Array = webcrypto.getRandomValues(new Uint8Array(10))): Id16 {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs >= 2 ** 48) throw new RangeError("timestamp out of range");
  if (rand.length < 10) throw new RangeError("need 10 random bytes");
  const b = new Uint8Array(16);
  let t = nowMs;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b.set(rand.subarray(0, 10), 6);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  return `0x${Buffer.from(b).toString("hex")}`;
}
