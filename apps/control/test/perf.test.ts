import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPublicClient, http, type PublicClient } from "viem";
import { Kind, Lane, signEnvelope } from "@tyrell/core";
import { importDataKey, MemoryBlobStore, newSecret, ProjectionDb } from "@tyrell/storage";
import { anchorDomain, Control, rebuildFresh } from "../src/index.js";
import { startChainlab, type Chainlab } from "../../../test/support/anvil.js";

let lab: Chainlab;
beforeAll(async () => {
  lab = await startChainlab();
}, 60_000);
afterAll(() => lab?.stop());

/** NFR-03: rebuild of 500 memories under 90 s (local chain; mainnet adds RPC and gateway latency). */
it("rebuilds 500 memories well inside 90 s", async () => {
  const clients = [0, 1].map(() => createPublicClient({ chain: lab.chain, transport: http(lab.url), pollingInterval: 50 })) as PublicClient[];
  const dataKey = await importDataKey(newSecret());
  const store = new MemoryBlobStore();
  const dir = mkdtempSync(join(tmpdir(), "tyrell-perf-"));
  const control = new Control({ deployment: lab.deployment, clients, submitter: lab.lanes.submitter, rpc: lab.url, dataKey, store, db: new ProjectionDb(join(dir, "live.sqlite")) });
  const domain = anchorDomain(lab.deployment);
  let parent: `0x${string}` | undefined;
  for (let batch = 0; batch < 25; batch++) {
    const refBlock = await lab.pub.getBlockNumber();
    const blobs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        signEnvelope(lab.lanes.agent, domain, { acct: lab.deployment.acct, lane: Lane.Agent, kind: Kind.Note, body: `note ${batch}-${i}`, refBlock, ...(parent ? { parents: [parent] } : {}) }),
      ),
    );
    const out = await control.submitBatch(blobs);
    parent = out[0]!.id;
  }
  const live = await control.refresh();
  const r = await rebuildFresh({ deployment: lab.deployment, clients, dataKey, store, dbPath: join(dir, "fresh.sqlite"), head: live.head });
  expect(r.counts.memories).toBe(500);
  expect(r.digest).toBe(live.digest);
  console.log(`NFR-03: rebuilt ${r.counts.memories} memories in ${Math.round(r.ms)} ms`);
  expect(r.ms).toBeLessThan(90_000);
}, 300_000);
