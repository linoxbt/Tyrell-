import { existsSync, rmSync } from "node:fs";
import type { PublicClient } from "viem";
import { readSnapshot, type Deployment } from "@tyrell/chain";
import { ProjectionDb, type BlobStore, type DataKey } from "@tyrell/storage";
import { buildProjection, recallRows, storeFetcher, type BuiltProjection } from "./projection.js";

export interface RebuildOptions {
  deployment: Deployment;
  clients: PublicClient[];
  dataKey: DataKey;
  store: BlobStore;
  dbPath: string;
  head?: bigint;
  window?: bigint;
}

export interface RebuildResult extends BuiltProjection {
  ms: number;
  counts: { memories: number; verified: number; unverified: Record<string, number>; quarantined: number; visible: number };
}

/**
 * `tyrell rebuild --fresh` (spec section 11): deletes the local cache and rebuilds everything from QIE
 * and IPFS, using only the data key, the account id and the contract addresses (G-6). Nothing is read
 * from the old cache.
 */
export async function rebuildFresh(o: RebuildOptions): Promise<RebuildResult> {
  const t0 = performance.now();
  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(o.dbPath + suffix)) rmSync(o.dbPath + suffix);
  const db = new ProjectionDb(o.dbPath);
  try {
    const snap = await readSnapshot(o.clients, o.deployment, {
      ...(o.head !== undefined ? { head: o.head } : { confirmations: 0n }),
      ...(o.window !== undefined ? { window: o.window } : {}),
    });
    // Keep each decrypted blob exactly as fetched, so the new cache holds what IPFS holds.
    const fetched = new Map<string, unknown>();
    const fromStore = storeFetcher(o.store, o.dataKey, o.deployment.acct);
    const built = await buildProjection(snap, o.deployment, async (a) => {
      const f = await fromStore(a);
      if (f.ok) fetched.set(a.id, f.blob);
      return f;
    });

    for (const r of built.results) {
      if (!r.anchor) continue;
      const a = r.anchor;
      db.putAnchor({
        id: a.id,
        lane: a.lane,
        signer: a.signer.toLowerCase(),
        ns: a.ns,
        structHash: a.structHash,
        parentsHash: a.parentsHash,
        bodyHash: a.bodyHash,
        cid: a.cid,
        refBlock: a.refBlock.toString(),
        block: a.pos.block.toString(),
        logIndex: a.pos.logIndex,
      });
      if (r.status === "verified") db.putBlob(r.id, fetched.get(r.id));
    }
    const rows = recallRows(built.projection);
    db.setVisible(rows);
    db.setMeta("head", built.head.toString());
    db.setMeta("digest", built.digest);

    const unverified: Record<string, number> = {};
    for (const r of built.results) if (r.status === "unverified") unverified[r.reason] = (unverified[r.reason] ?? 0) + 1;
    return {
      ...built,
      ms: performance.now() - t0,
      counts: {
        memories: built.results.length,
        verified: built.results.filter((r) => r.status === "verified").length,
        unverified,
        quarantined: [...built.projection.values()].filter((m) => m.quarantined).length,
        visible: rows.length,
      },
    };
  } finally {
    db.close();
  }
}
