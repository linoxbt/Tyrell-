import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import {
  Blob,
  bodyHashOf,
  bodyLenOf,
  nsHash,
  parentsHashOf,
  toMemoryStruct,
  type AnchorDomain,
  type Header,
} from "./envelope.js";
import type { Id16 } from "./ids.js";
import type { ChainPos, KeyHistory } from "./keys.js";
import { memoryStructHash, memoryTypedData } from "./typedData.js";

/** One MemoryAnchored event, with where it sits on chain. */
export interface AnchorRecord {
  id: Id16;
  lane: number;
  signer: Address;
  ns: Hex;
  structHash: Hex;
  parentsHash: Hex;
  bodyHash: Hex;
  cid: string;
  refBlock: bigint;
  pos: ChainPos;
}

/** Result of fetching and decrypting a CID. Decryption lives in storage; the verifier only sees the outcome. */
export type BlobFetch = { ok: true; blob: unknown } | { ok: false; reason: "BODY_UNAVAILABLE" | "DECRYPT_FAILED"; detail?: string };

export interface VerifyContext {
  acct: Hex;
  domain: AnchorDomain;
  keys: KeyHistory;
}

export const UNVERIFIED_REASONS = [
  "NO_ANCHOR",
  "BODY_UNAVAILABLE",
  "DECRYPT_FAILED",
  "MALFORMED_ENVELOPE",
  "ID_MISMATCH",
  "ACCOUNT_MISMATCH",
  "BODY_HASH_MISMATCH",
  "BODY_LEN_MISMATCH",
  "PARENTS_HASH_MISMATCH",
  "NAMESPACE_MISMATCH",
  "HEADER_HASH_MISMATCH",
  "BAD_SIGNATURE",
  "SIGNER_MISMATCH",
  "UNBOUND_KEY",
  "LANE_MISMATCH",
  "REFBLOCK_AFTER_ANCHOR",
] as const;
export type UnverifiedReason = (typeof UNVERIFIED_REASONS)[number];

export interface Verified {
  status: "verified";
  id: Id16;
  header: Header;
  body: string;
  signer: Address;
  anchor: AnchorRecord;
}

export interface Unverified {
  status: "unverified";
  id: Id16;
  reason: UnverifiedReason;
  detail?: string;
  anchor?: AnchorRecord;
  /** Present when the header parsed, so lineage can still follow its parents. */
  header?: Header;
}

export type VerifyResult = Verified | Unverified;

/**
 * Verifies one memory in the order of spec section 6; the first failure ends it (I-2: default deny).
 *  1. an anchor exists for the id
 *  2. the CID resolved, the blob decrypted and the header parses, with matching id and account
 *  3. bodyHash, bodyLen, parentsHash, ns and the full struct hash match the anchored values
 *  4. the EIP-712 signature recovers to the anchored signer
 *  5. the signer's lane at the anchor position equals the header's lane (LaneRegistry history)
 *  6. refBlock <= anchor block
 */
export async function verifyMemory(id: Id16, anchor: AnchorRecord | undefined, fetched: BlobFetch, ctx: VerifyContext): Promise<VerifyResult> {
  const fail = (reason: UnverifiedReason, detail?: string, header?: Header): Unverified => ({
    status: "unverified",
    id,
    reason,
    ...(detail !== undefined ? { detail } : {}),
    ...(anchor ? { anchor } : {}),
    ...(header ? { header } : {}),
  });

  // 1
  if (!anchor) return fail("NO_ANCHOR");

  // 2
  if (!fetched.ok) return fail(fetched.reason, fetched.detail);
  const parsed = Blob.safeParse(fetched.blob);
  if (!parsed.success) return fail("MALFORMED_ENVELOPE", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { header, body, signature } = parsed.data;
  if (header.id !== anchor.id.toLowerCase() || header.id !== id.toLowerCase()) return fail("ID_MISMATCH", undefined, header);
  if (header.acct !== ctx.acct.toLowerCase()) return fail("ACCOUNT_MISMATCH", undefined, header);

  // 3
  if (bodyHashOf(body) !== anchor.bodyHash.toLowerCase()) return fail("BODY_HASH_MISMATCH", undefined, header);
  if (bodyLenOf(body) !== header.bodyLen) return fail("BODY_LEN_MISMATCH", `header ${header.bodyLen}, body ${bodyLenOf(body)}`, header);
  if (parentsHashOf(header.parents) !== anchor.parentsHash.toLowerCase()) return fail("PARENTS_HASH_MISMATCH", undefined, header);
  if (nsHash(header.ns) !== anchor.ns.toLowerCase()) return fail("NAMESPACE_MISMATCH", undefined, header);
  const struct = toMemoryStruct(header, body);
  if (memoryStructHash(struct) !== anchor.structHash.toLowerCase()) return fail("HEADER_HASH_MISMATCH", undefined, header);

  // 4
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({ ...memoryTypedData(struct, ctx.domain), signature: signature as Hex });
  } catch (e) {
    return fail("BAD_SIGNATURE", (e as Error).message, header);
  }
  if (recovered.toLowerCase() !== anchor.signer.toLowerCase()) return fail("SIGNER_MISMATCH", `recovered ${recovered}`, header);

  // 5
  const lane = ctx.keys.laneAt(recovered, anchor.pos);
  if (lane === undefined) return fail("UNBOUND_KEY", recovered, header);
  if (lane !== header.lane) return fail("LANE_MISMATCH", `key is lane ${lane}, envelope claims ${header.lane}`, header);

  // 6
  if (BigInt(header.refBlock) > anchor.pos.block) return fail("REFBLOCK_AFTER_ANCHOR", undefined, header);

  return { status: "verified", id, header, body, signer: recovered, anchor };
}
