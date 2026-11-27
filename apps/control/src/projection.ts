import {
  computeProjection,
  digestDocument,
  KeyHistory,
  projectionDigest,
  verifyMemory,
  visible,
  type AnchorDomain,
  type AnchorRecord,
  type BlobFetch,
  type Projection,
  type VerifyResult,
} from "@tyrell/core";
import type { ChainSnapshot, Deployment } from "@tyrell/chain";
import { BlobUnavailable, DecryptError, openBlob, type BlobStore, type DataKey, type RecallRow } from "@tyrell/storage";
import type { Hex } from "viem";

export interface BuiltProjection {
  head: bigint;
  snapshot: ChainSnapshot;
  results: VerifyResult[];
  projection: Projection;
  digest: Hex;
  document: ReturnType<typeof digestDocument>;
  keys: KeyHistory;
}

export type BlobFetcher = (a: AnchorRecord) => Promise<BlobFetch>;

/** Fetches a CID from a store and decrypts it, mapping failures to the verifier's reasons. */
export function storeFetcher(store: BlobStore, dataKey: DataKey, acct: Hex): BlobFetcher {
  return async (a) => {
    let sealed: Uint8Array;
    try {
      sealed = await store.get(a.cid);
    } catch (e) {
      return { ok: false, reason: "BODY_UNAVAILABLE", detail: e instanceof BlobUnavailable ? e.message : String(e) };
    }
    try {
      return { ok: true, blob: await openBlob(dataKey, acct, a.id, sealed) };
    } catch (e) {
      return { ok: false, reason: "DECRYPT_FAILED", detail: e instanceof DecryptError ? e.message : String(e) };
    }
  };
}

/** domain for verifying signatures against this deployment's MemoryAnchor. */
export const anchorDomain = (d: Deployment): AnchorDomain => ({ chainId: d.chainId, memoryAnchor: d.memoryAnchor });

/**
 * Verifies every anchored memory, computes classes and quarantine, and the digest. Used both by the
 * live control process (blobs from its cache) and by `rebuild --fresh` (blobs from IPFS only), so the
 * two can only differ if the cache holds something the chain and IPFS do not (I-10).
 */
export async function buildProjection(snap: ChainSnapshot, d: Deployment, fetchBlob: BlobFetcher, concurrency = 8): Promise<BuiltProjection> {
  const keys = new KeyHistory(snap.laneEvents);
  const ctx = { acct: d.acct, domain: anchorDomain(d), keys };
  const results: VerifyResult[] = new Array(snap.anchors.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, snap.anchors.length) }, async () => {
      while (next < snap.anchors.length) {
        const i = next++;
        const a = snap.anchors[i]!;
        results[i] = await verifyMemory(a.id, a, await fetchBlob(a), ctx);
      }
    }),
  );
  const projection = computeProjection(results, snap.ledger.seeds);
  const input = { acct: d.acct, head: snap.head, projection, payees: snap.ledger.payees, seeds: snap.ledger.seeds };
  return { head: snap.head, snapshot: snap, results, projection, digest: projectionDigest(input), document: digestDocument(input), keys };
}

/** Rows for the recall index: visible memories only, with their class for context labels. */
export const recallRows = (p: Projection): RecallRow[] =>
  visible(p)
    .filter((m) => m.body !== undefined)
    .map((m) => ({ id: m.id, cls: m.cls, body: m.body! }));
