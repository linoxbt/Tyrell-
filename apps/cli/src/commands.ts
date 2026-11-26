import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { firstDifference, Kind, Lane, signEnvelope, type digestDocument } from "@tyrell/core";
import { call } from "@tyrell/ipc";
import { anchorDomain, rebuildFresh, type Anchored, type RebuildResult } from "@tyrell/control";
import { account, blobStore, checkKeyIsolation, clients, dataKey, deployment, paths, readConfig } from "./config.js";

/** True if a control process is listening on the socket. */
export function controlRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(paths().socket)) return resolve(false);
    const s = createConnection(paths().socket);
    s.once("connect", () => {
      s.end();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

/**
 * `tyrell say "<text>"`: a user-lane statement. Signed here, in the human's CLI process, with the user
 * key; control only verifies and anchors it. This is the only way to create a trusted memory (I-4).
 */
export async function say(text: string): Promise<Anchored> {
  checkKeyIsolation("cli");
  const c = readConfig();
  const d = deployment(c);
  const user = account("cli", "user");
  const refBlock = await clients(c)[0]!.getBlockNumber({ cacheTime: 0 });
  const blob = await signEnvelope(user, anchorDomain(d), {
    acct: d.acct,
    lane: Lane.User,
    kind: Kind.Statement,
    body: text,
    refBlock,
    src: [{ t: "user-msg", id: `cli-${Date.now()}` }],
  });
  return (await call(paths().socket, { type: "submit", blob })) as Anchored;
}

export const status = () => call(paths().socket, { type: "status" });
export const show = (id: string, forensic: boolean) => call(paths().socket, { type: "show", id: id.toLowerCase(), forensic });

/**
 * `tyrell rebuild --fresh`: a fresh process, with no local state, rebuilds the projection from QIE and
 * IPFS alone. Runs with control's keys (it needs the data key). Refuses to replace the live database
 * while control is running; use --out for a side-by-side rebuild.
 */
export async function rebuild(o: { out?: string; head?: bigint } = {}): Promise<RebuildResult> {
  const out = o.out ?? paths().db;
  if (out === paths().db && (await controlRunning())) throw new Error("control is running: stop it first, or pass --out <path>");
  const c = readConfig();
  return rebuildFresh({
    deployment: deployment(c),
    clients: clients(c),
    dataKey: await dataKey("control"),
    store: blobStore(c),
    dbPath: out,
    ...(o.head !== undefined ? { head: o.head } : {}),
  });
}

export interface VerifyReport {
  head: string;
  live: string;
  rebuilt: string;
  match: boolean;
  firstDifference?: string;
  rebuildMs: number;
}

/** `tyrell verify --head <block>`: live digest from control against a fresh rebuild at the same head. */
export async function verifyDigest(head: bigint): Promise<VerifyReport> {
  const live = (await call(paths().socket, { type: "digest", head: head.toString() })) as {
    digest: string;
    document: ReturnType<typeof digestDocument>;
  };
  const dir = mkdtempSync(join(tmpdir(), "tyrell-verify-"));
  try {
    const r = await rebuild({ out: join(dir, "rebuild.sqlite"), head });
    const diff = firstDifference(live.document, r.document);
    return { head: head.toString(), live: live.digest, rebuilt: r.digest, match: live.digest === r.digest, ...(diff ? { firstDifference: diff } : {}), rebuildMs: Math.round(r.ms) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
