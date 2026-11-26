import type { Server } from "node:net";
import { formatEther } from "viem";
import type { Id16 } from "@tyrell/core";
import { serve, type Request } from "@tyrell/ipc";
import { Control, type BuiltProjection } from "@tyrell/control";
import { ProjectionDb } from "@tyrell/storage";
import { account, blobStore, checkKeyIsolation, clients, dataKey, deployment, paths, readConfig } from "./config.js";

export interface Daemon {
  control: Control;
  server: Server;
  stop: () => Promise<void>;
}

function summary(p: BuiltProjection) {
  const counts: Record<string, number> = {};
  let quarantined = 0;
  for (const m of p.projection.values()) {
    counts[m.cls] = (counts[m.cls] ?? 0) + 1;
    if (m.quarantined) quarantined++;
  }
  return { head: p.head.toString(), digest: p.digest, memories: p.projection.size, classes: counts, quarantined };
}

/**
 * `tyrell control start`: the control process. Holds the control, submitter and data keys only,
 * listens on a Unix socket for lane processes, and refreshes the projection on a timer.
 */
export async function startDaemon(o: { refreshMs?: number; log?: (s: string) => void } = {}): Promise<Daemon> {
  const log = o.log ?? ((s: string) => console.error(s));
  const foreign = checkKeyIsolation("control");
  if (foreign.length) log(`warning: control can read ${foreign.length} key file(s) of other roles; run each process as its own OS user in production (TYRELL_STRICT_KEYS=1 enforces it)`);
  const c = readConfig();
  const d = deployment(c);
  const cs = clients(c);
  const submitter = account("control", "submitter");
  const db = new ProjectionDb(paths().db);
  const control = new Control({ deployment: d, clients: cs, submitter, rpc: c.rpcs[0]!, dataKey: await dataKey("control"), store: blobStore(c), db });
  const first = await control.start();
  log(`control: ${first.projection.size} memories at block ${first.head}, digest ${first.digest}`);

  const handler = async (req: Request): Promise<unknown> => {
    switch (req.type) {
      case "submit":
        return control.submit(req.blob);
      case "submitBatch":
        return control.submitBatch(req.blobs);
      case "refresh":
        return summary(await control.refresh());
      case "status": {
        const p = control.projection ?? (await control.refresh());
        const bal = await cs[0]!.getBalance({ address: submitter.address });
        return {
          ...summary(p),
          network: c.network,
          chainId: c.chainId,
          contracts: { laneRegistry: d.laneRegistry, memoryAnchor: d.memoryAnchor, tyrellLedger: d.tyrellLedger, guardedVault: d.guardedVault, token: d.token },
          laneKeys: Object.fromEntries([...p.keys.activeKeys()].map(([lane, key]) => [lane, key])),
          submitter: { address: submitter.address, balance: formatEther(bal) },
          activeSeeds: [...new Set([...p.projection.values()].flatMap((m) => m.seeds))].sort((a, b) => a - b),
        };
      }
      case "recall":
        return db.search(req.query, req.limit ?? 8);
      case "show": {
        const p = control.projection ?? (await control.refresh());
        const m = p.projection.get(req.id as Id16);
        if (!m) throw new Error(`unknown memory ${req.id}`);
        const visible = m.cls !== "unverified" && !m.quarantined;
        if (!visible && !req.forensic) return { id: m.id, cls: m.cls, quarantined: m.quarantined, note: "excluded; use --forensic to see it" };
        const r = p.results.find((x) => x.id === m.id);
        return {
          id: m.id,
          lane: m.lane,
          kind: m.kind,
          cls: m.cls,
          clsReason: m.clsReason,
          quarantined: m.quarantined,
          seeds: m.seeds,
          parents: m.parents,
          signer: m.signer,
          anchor: m.anchorPos ? { block: m.anchorPos.block.toString(), logIndex: m.anchorPos.logIndex, cid: r?.anchor?.cid } : undefined,
          verification: r?.status === "verified" ? "verified" : (r as { reason?: string })?.reason,
          src: m.header?.src,
          body: m.body,
        };
      }
      case "digest": {
        const p = await control.refresh(BigInt(req.head));
        return { head: p.head.toString(), digest: p.digest, document: p.document };
      }
    }
  };

  const server = await serve(paths().socket, handler);
  const timer = setInterval(() => void control.refresh().catch((e: Error) => log(`refresh failed: ${e.message}`)), o.refreshMs ?? 15_000);
  log(`control: listening on ${paths().socket}`);
  return {
    control,
    server,
    stop: async () => {
      clearInterval(timer);
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
    },
  };
}

