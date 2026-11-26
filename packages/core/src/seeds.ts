import { pad, type Address, type Hex } from "viem";
import { canonicalHash } from "./canonical.js";
import { SeedType } from "./constants.js";
import type { Header, SrcRef } from "./envelope.js";
import type { Id16 } from "./ids.js";
import type { ChainPos } from "./keys.js";

/** A quarantine seed as stored in TyrellLedger (`seed(seedId)`). */
export interface Seed {
  seedId: number;
  type: SeedType;
  value: Hex; // bytes32
  fromBlock: bigint;
  toBlock: bigint;
  released: boolean;
}

// Seed value encodings. They mirror Solidity casts so the contract and core agree:
//   address  -> bytes32(uint256(uint160(addr)))   (left-padded)
//   bytes16  -> bytes32(bytes16)                   (right-padded)
//   tx hash  -> as is

export const addressSeedValue = (a: Address): Hex => pad(a.toLowerCase() as Hex, { size: 32, dir: "left" });
export const id16SeedValue = (id: Id16): Hex => pad(id.toLowerCase() as Hex, { size: 32, dir: "right" });

/** `source` seed for an address (token contract, NFT contract, sender) or a 32-byte transaction hash. */
export function sourceSeedValue(ref: Address | Hex): Hex {
  const v = ref.toLowerCase() as Hex;
  if (/^0x[0-9a-f]{40}$/.test(v)) return addressSeedValue(v as Address);
  if (/^0x[0-9a-f]{64}$/.test(v)) return v;
  throw new Error("source seed must be an address or a 32-byte hash");
}

/** Every seed value a src ref can be matched by: its addresses, its tx hash, and its own canonical hash. */
export function srcRefValues(ref: SrcRef): Hex[] {
  const out: Hex[] = [canonicalHash(ref)];
  if ("addr" in ref) out.push(addressSeedValue(ref.addr as Address));
  if ("from" in ref && ref.from) out.push(addressSeedValue(ref.from as Address));
  if ("tx" in ref && ref.tx) out.push(ref.tx.toLowerCase() as Hex);
  return out;
}

/** What a memory exposes for direct seed matching. Unverified memories may lack a header. */
export interface SeedSubject {
  id: Id16;
  header?: Pick<Header, "src" | "turn">;
  signer?: Address;
  anchorPos?: ChainPos;
}

/** True if `seed` directly matches `m` (descendants are handled by the lineage pass). */
export function seedMatches(seed: Seed, m: SeedSubject): boolean {
  if (seed.released) return false;
  const v = seed.value.toLowerCase();
  switch (seed.type) {
    case SeedType.Memory:
      return id16SeedValue(m.id) === v;
    case SeedType.Source:
      return !!m.header && m.header.src.some((r) => srcRefValues(r).includes(v as Hex));
    case SeedType.SignerWindow:
      return (
        !!m.signer &&
        !!m.anchorPos &&
        addressSeedValue(m.signer) === v &&
        m.anchorPos.block >= seed.fromBlock &&
        m.anchorPos.block <= seed.toBlock
      );
    case SeedType.Turn:
      return !!m.header && /[1-9a-f]/.test(m.header.turn.slice(2)) && id16SeedValue(m.header.turn) === v;
    default:
      return false;
  }
}
