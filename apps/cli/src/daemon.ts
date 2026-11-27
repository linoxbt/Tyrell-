import type { Server } from "node:net";
import { readFileSync } from "node:fs";
import { erc20Abi, formatEther, type Address } from "viem";
import type { Id16 } from "@tyrell/core";
import { call, serve, type Request } from "@tyrell/ipc";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { networks } from "@tyrell/chain";
import { Control, Payments, Quarantine, viewDocument, type BuiltProjection, type SeedSpec, type SignedPayRequest } from "@tyrell/control";
import type { SeedSpecMsg } from "@tyrell/ipc";
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
  const dk = await dataKey("control");
  const store = blobStore(c);
  const control = new Control({ deployment: d, clients: cs, submitter, rpc: c.rpcs[0]!, dataKey: dk, store, db });
  const first = await control.start();
  const addresses = JSON.parse(readFileSync(paths().addresses, "utf8")) as Record<string, Address>;
  const payments = new Payments({
    control,
    clients: cs,
    controlKey: account("control", "control"),
    signerAddress: addresses.signer!,
    signer: (r: SignedPayRequest) => call(paths().signerSocket, r) as Promise<{ txHash: `0x${string}` }>,
  });
  const quarantine = new Quarantine({ control, clients: cs, controlKey: account("control", "control"), submitter, rpc: c.rpcs[0]!, store, dataKey: dk });
  const seedSpec = (m: SeedSpecMsg): SeedSpec =>
    m.type === "signer-window"
      ? { type: "signer-window", signer: m.signer as Address, fromBlock: BigInt(m.fromBlock), toBlock: BigInt(m.toBlock) }
      : m.type === "source"
        ? { type: "source", ref: m.ref as Address }
        : m.type === "memory"
          ? { type: "memory", id: m.id as `0x${string}` }
          : { type: "turn", turn: m.turn as `0x${string}` };
  log(`control: ${first.projection.size} memories at block ${first.head}, digest ${first.digest}`);

  const [decimals, symbol] = await Promise.all([
    cs[0]!.readContract({ address: d.token, abi: erc20Abi, functionName: "decimals" }),
    cs[0]!.readContract({ address: d.token, abi: erc20Abi, functionName: "symbol" }),
  ]);
  const view = (p: BuiltProjection) =>
    viewDocument(p, {
      network: c.network,
      chainId: c.chainId,
      contracts: { laneRegistry: d.laneRegistry, memoryAnchor: d.memoryAnchor, tyrellLedger: d.tyrellLedger, guardedVault: d.guardedVault, token: d.token },
      ...(c.network !== "local" ? { explorer: networks[c.network].explorer } : {}),
      token: { address: d.token, decimals, symbol },
      incidents: db.incidents(),
    });

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
        await control.refresh(); // recall must see the latest anchors and the latest quarantine
        return db.search(req.query, req.limit ?? 8);
      case "propose":
        return payments.decide(req.proposal, req.readSet as `0x${string}`[], req.turn as `0x${string}`);
      case "incident":
        db.addIncident(String(req.incident.memoryId), req.incident);
        log(`incident: score ${String(req.incident.score)} source ${String(req.incident.source)} (${String((req.incident.rules as string[] | undefined)?.join(", "))})`);
        return { recorded: true };
      case "incidents":
        return db.incidents();
      case "quarantine": {
        const spec = seedSpec(req.seed);
        if (req.preview) {
          const pv = await quarantine.preview(spec);
          return { memories: pv.memories, decisions: pv.decisions, vaultTxs: pv.vaultTxs, payeesSuspended: pv.payeesSuspended, radius: pv.radius };
        }
        return quarantine.seed(spec, req.reason, req.evidence ?? {});
      }
      case "blast":
        return quarantine.blast(req.seedId);
      case "view":
        return view(await control.refresh());
      case "ledger":
        return control.relayLedger(req.action, req.message, req.signature as `0x${string}`);
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

  // Read-only HTTP API for the web view, on 127.0.0.1 only. GET /api/view; nothing writes.
  const apiPort = Number(process.env.TYRELL_API_PORT ?? 7878);
  let http: HttpServer | undefined;
  if (apiPort > 0) {
    http = createHttpServer((req, res) => {
      if (req.method !== "GET" || req.url !== "/api/view") return void res.writeHead(404).end();
      const p = control.projection;
      if (!p) return void res.writeHead(503).end();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(view(p)));
    });
    await new Promise<void>((r) => http!.listen(apiPort, "127.0.0.1", () => r()));
    log(`control: read-only web API on http://127.0.0.1:${apiPort}/api/view`);
  }
  const timer = setInterval(() => void control.refresh().catch((e: Error) => log(`refresh failed: ${e.message}`)), o.refreshMs ?? 15_000);
  log(`control: listening on ${paths().socket}`);
  return {
    control,
    server,
    stop: async () => {
      clearInterval(timer);
      http?.close();
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
    },
  };
}

