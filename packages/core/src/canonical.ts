import canonicalizeImpl from "canonicalize";
import { keccak256, toBytes, type Hex } from "viem";

const canonicalizeFn = canonicalizeImpl as unknown as (v: unknown) => string | undefined;

/** RFC 8785 canonical JSON. Throws on values JSON cannot represent (undefined, bigint, functions). */
export function canonicalJson(value: unknown): string {
  const out = canonicalizeFn(value);
  if (out === undefined) throw new TypeError("value has no canonical JSON form");
  return out;
}

/** keccak256 of the UTF-8 bytes of RFC 8785 canonical JSON. */
export function canonicalHash(value: unknown): Hex {
  return keccak256(toBytes(canonicalJson(value)));
}
