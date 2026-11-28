import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

/*
 * The view document control serves on its local read-only API (GET /api/view, apps/cli/src/daemon.ts).
 * Everything in it is data: memory bodies, token names and incident summaries were written by other
 * people (often an attacker), so the server checks its shape and never follows what it says.
 */

const memory = z.looseObject({
  id: z.string(),
  lane: z.number(),
  laneName: z.string(),
  kind: z.number(),
  cls: z.string(),
  clsReason: z.string(),
  quarantined: z.boolean(),
  seeds: z.array(z.number()),
  parents: z.array(z.string()),
  signer: z.string().optional(),
  block: z.string().optional(),
  logIndex: z.number().optional(),
  cid: z.string().optional(),
  verification: z.string(),
  body: z.string().optional(),
  src: z.array(z.unknown()),
  ts: z.string().optional(),
});

const decision = z.looseObject({
  id: z.string(),
  turn: z.string().optional(),
  verdict: z.looseObject({ decision: z.string(), code: z.string(), reasons: z.array(z.string()) }).optional(),
  proposal: z.record(z.string(), z.unknown()).optional(),
  outcome: z.enum(["paid", "failed", "unknown"]).optional(),
  txHash: z.string().optional(),
  payError: z.string().optional(),
  parents: z.array(z.string()),
});

const incident = z.looseObject({
  memoryId: z.string(),
  source: z.string(),
  score: z.number(),
  rules: z.array(z.string()),
  summary: z.string().optional(),
  block: z.string().optional(),
  ai: z.looseObject({ injection: z.boolean(), confidence: z.number(), category: z.string(), reason: z.string(), model: z.string(), score: z.number() }).optional(),
});

export const viewSchema = z.looseObject({
  v: z.literal(1),
  generatedAt: z.string(),
  network: z.string(),
  chainId: z.number(),
  head: z.string(),
  digest: z.string(),
  contracts: z.record(z.string(), z.string()),
  explorer: z.string().optional(),
  token: z.looseObject({ address: z.string(), decimals: z.number(), symbol: z.string() }).optional(),
  memories: z.array(memory),
  decisions: z.array(decision),
  seeds: z.array(z.looseObject({ seedId: z.number(), type: z.number(), value: z.string(), fromBlock: z.string(), toBlock: z.string(), released: z.boolean() })),
  payees: z.array(
    z.looseObject({ payeeId: z.string(), label: z.string(), addr: z.string(), token: z.string(), capPerTx: z.string(), capPerDay: z.string(), active: z.boolean(), suspended: z.boolean() }),
  ),
  incidents: z.array(incident),
});

export type ViewDocument = z.infer<typeof viewSchema>;
export type ViewMemory = z.infer<typeof memory>;
export type ViewDecision = z.infer<typeof decision>;
export type ViewIncident = z.infer<typeof incident>;

/** Parse and check a view document; throws a short message on anything malformed. */
export function parseView(raw: unknown): ViewDocument {
  const r = viewSchema.safeParse(raw);
  if (!r.success) throw new Error(`control's view document is malformed (${r.error.issues[0]?.path.join(".") || "root"}: ${r.error.issues[0]?.message})`);
  return r.data;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_BYTES = 32 * 1024 * 1024;

export interface ViewSource {
  url: string;
  token: () => string;
}

/**
 * Where the view comes from. Loopback only: the bearer token unlocks decrypted memories, so it is never
 * sent anywhere but this machine's control process.
 *   TYRELL_API_URL   default http://127.0.0.1:${TYRELL_API_PORT ?? 7878}
 *   TYRELL_API_TOKEN default: the contents of TYRELL_HOME/api-token (written by `tyrell control start`)
 */
export function viewSourceFromEnv(env: NodeJS.ProcessEnv = process.env): ViewSource {
  const base = env.TYRELL_API_URL ?? `http://127.0.0.1:${env.TYRELL_API_PORT ?? 7878}`;
  const u = new URL(base);
  if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname)) throw new Error(`TYRELL_API_URL must be http://127.0.0.1, localhost or [::1] (got ${u.origin}): the token is never sent off this machine`);
  const file = join(resolve(env.TYRELL_HOME ?? join(homedir(), ".tyrell")), "api-token");
  return {
    url: `${u.origin}/api/view`,
    token: () => {
      if (env.TYRELL_API_TOKEN) return env.TYRELL_API_TOKEN;
      try {
        return readFileSync(file, "utf8").trim();
      } catch {
        throw new Error(`no API token: set TYRELL_API_TOKEN or start control once (pnpm tyrell control start) so ${file} exists`);
      }
    },
  };
}

/** Fetches the view, with a short cache so a burst of tool calls makes one request. */
export function viewClient(src: ViewSource, o: { ttlMs?: number; timeoutMs?: number; fetch?: typeof fetch } = {}): () => Promise<ViewDocument> {
  const ttl = o.ttlMs ?? 2_000;
  const doFetch = o.fetch ?? fetch;
  let cached: { at: number; doc: ViewDocument } | undefined;
  return async () => {
    if (cached && Date.now() - cached.at < ttl) return cached.doc;
    let r: Response;
    try {
      r = await doFetch(src.url, { headers: { authorization: `Bearer ${src.token()}` }, signal: AbortSignal.timeout(o.timeoutMs ?? 10_000), redirect: "error" });
    } catch (e) {
      const m = (e as Error).message;
      throw new Error(m.startsWith("no API token") ? m : `control's view API at ${src.url} did not answer (is \`pnpm tyrell control start\` running?): ${m}`);
    }
    if (r.status === 401) throw new Error("control refused the API token (401): check TYRELL_API_TOKEN or TYRELL_HOME/api-token");
    if (r.status === 503) throw new Error("control has no projection yet (503): try again in a few seconds");
    if (!r.ok) throw new Error(`control's view API answered HTTP ${r.status}`);
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error("control's view document is too large");
    const text = await r.text();
    if (text.length > MAX_BYTES) throw new Error("control's view document is too large");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("control's view API did not return JSON");
    }
    const doc = parseView(raw);
    cached = { at: Date.now(), doc };
    return doc;
  };
}
