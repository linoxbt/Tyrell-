import { createConnection, createServer, type Server, type Socket } from "node:net";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { z, type ZodType } from "zod";

/**
 * Local IPC between Tyrell processes: newline-delimited JSON over a Unix domain socket (spec
 * section 13). Lane processes hand signed envelopes to control; they never share memory or keys.
 * Every request is parsed with zod before it reaches a handler.
 */

const blob = z.object({ header: z.record(z.unknown()), body: z.string(), signature: z.string() });
const id16 = z.string().regex(/^0x[0-9a-f]{32}$/);
const digits = z.string().regex(/^\d{1,78}$/);

/** What Steward's propose_payment tool sends after the runtime converts the amount to base units. */
export const Proposal = z
  .object({
    recipient: z.string().max(128),
    amount: digits,
    token: z.string().max(64),
    payeeLabel: z.string().max(64).optional(),
    reason: z.string().max(1024).optional(),
    cites: z.array(z.string().max(66)).max(32).optional(),
  })
  .strict();
export type Proposal = z.infer<typeof Proposal>;

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/** A quarantine seed as the CLI or ingest asks for it (spec section 7, seed types). */
export const SeedSpecMsg = z.discriminatedUnion("type", [
  z.object({ type: z.literal("memory"), id: id16 }),
  z.object({ type: z.literal("source"), ref: z.union([addr, hex32]) }),
  z.object({ type: z.literal("signer-window"), signer: addr, fromBlock: digits, toBlock: digits }),
  z.object({ type: z.literal("turn"), turn: id16 }),
]);
export type SeedSpecMsg = z.infer<typeof SeedSpecMsg>;

/**
 * A lane key's signature over a request (S-6; see @tyrell/core requestAuth). Required on the requests
 * that make control act: propose (agent lane), incident (wallet lane), quarantine (user lane, or the
 * wallet lane for an automatic source seed). Read-only requests carry none.
 */
export const RequestAuthMsg = z
  .object({ by: addr, nonce: id16, expires: z.number().int().positive(), sig: z.string().regex(/^0x[0-9a-fA-F]{130}$/) })
  .strict();

export const LEDGER_ACTIONS = ["AddPayee", "RemovePayee", "ReinstatePayee", "ReleaseQuarantine"] as const;

export const Request = z.discriminatedUnion("type", [
  z.object({ type: z.literal("submit"), blob }),
  z.object({ type: z.literal("submitBatch"), blobs: z.array(blob).min(1).max(20) }),
  z.object({ type: z.literal("status") }),
  /** `turn`: Steward's turn, so control can check its proposals cite everything it was served. */
  z.object({ type: z.literal("recall"), query: z.string().max(512), limit: z.number().int().min(1).max(32).optional(), turn: id16.optional() }),
  z.object({ type: z.literal("show"), id: z.string().regex(/^0x[0-9a-f]{32}$/), forensic: z.boolean().optional() }),
  z.object({ type: z.literal("refresh") }),
  /** Steward: a payment proposal, with the turn's readSet set by the runtime (I-3). */
  z.object({ type: z.literal("propose"), proposal: Proposal, readSet: z.array(id16).max(256), turn: id16, auth: RequestAuthMsg }),
  /** Ingest: a sentinel incident (detection only proposes). */
  z.object({ type: z.literal("incident"), incident: z.record(z.unknown()), auth: RequestAuthMsg }),
  z.object({ type: z.literal("incidents") }),
  /** CLI or ingest auto-quarantine: preview, or seed with the control key. */
  z.object({ type: z.literal("quarantine"), seed: SeedSpecMsg, reason: z.string().min(1).max(2000), evidence: z.unknown().optional(), preview: z.boolean().optional(), auth: RequestAuthMsg.optional() }),
  z.object({ type: z.literal("blast"), seedId: z.number().int().nonnegative() }),
  /** The web view's document (read-only). */
  z.object({ type: z.literal("view") }),
  /** Human CLI: a user-signed ledger action that control only relays as a transaction. */
  z.object({ type: z.literal("ledger"), action: z.enum(LEDGER_ACTIONS), message: z.record(z.unknown()), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }),
  z.object({ type: z.literal("digest"), head: z.string().regex(/^\d+$/) }),
]);
export type Request = z.infer<typeof Request>;

export type Response = { ok: true; result: unknown } | { ok: false; error: string };

const MAX_LINE = 1 << 20;

/** JSON that survives bigint: encoded as {"$bigint":"123"}. */
export const encode = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? { $bigint: x.toString() } : x));
export const decode = (s: string): unknown =>
  JSON.parse(s, (_k, x) => (x && typeof x === "object" && typeof x.$bigint === "string" && Object.keys(x).length === 1 ? BigInt(x.$bigint) : x));

export type Handler<R = Request> = (req: R) => Promise<unknown>;

/**
 * Serves requests on a Unix socket. Requests are parsed with `schema`. The socket is 0600 (this OS
 * user only) unless `mode` says otherwise: with one OS user per process (NFR-02), give the socket
 * 0660 and a group the lane users share; requests that act are signed by lane keys either way.
 */
export function serve<R = Request>(path: string, handler: Handler<R>, schema: ZodType<R> = Request as unknown as ZodType<R>, mode = 0o600): Promise<Server> {
  if (existsSync(path)) unlinkSync(path);
  const server = createServer((sock: Socket) => {
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_LINE) {
        sock.end(encode({ ok: false, error: "request too large" }) + "\n");
        return;
      }
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        void respond(line).then((r) => sock.write(encode(r) + "\n"));
      }
    });
    sock.on("error", () => sock.destroy());
  });
  const respond = async (line: string): Promise<Response> => {
    let parsed;
    try {
      parsed = schema.safeParse(decode(line));
    } catch {
      return { ok: false, error: "invalid JSON" };
    }
    if (!parsed.success) return { ok: false, error: `invalid request: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
    try {
      return { ok: true, result: await handler(parsed.data) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  };
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      chmodSync(path, mode);
      resolve(server);
    });
  });
}

/** The other process answered with an error: the request was received and refused. */
export class RemoteError extends Error {}
/**
 * No answer: the request may or may not have been acted on. `delivered` is false when the connection
 * failed before the request was written, so the other process never saw it.
 */
export class CallFailed extends Error {
  constructor(
    message: string,
    readonly delivered: boolean,
  ) {
    super(message);
  }
}

/** Sends one request and waits for its response. */
export function call<R = Request>(path: string, req: R, timeoutMs = 120_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(path);
    let buf = "";
    let written = false;
    let done = false;
    const finish = (f: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      f();
    };
    const timer = setTimeout(() => {
      sock.destroy();
      finish(() => reject(new CallFailed(`no answer from ${path} in time`, written)));
    }, timeoutMs);
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      written = true;
      sock.write(encode(req) + "\n");
    });
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      sock.end();
      finish(() => {
        let r: Response;
        try {
          r = decode(buf.slice(0, nl)) as Response;
        } catch {
          return reject(new CallFailed("unreadable answer", true));
        }
        if (r.ok) resolve(r.result);
        else reject(new RemoteError(r.error));
      });
    });
    sock.on("error", (e) => finish(() => reject(new CallFailed(e.message, written))));
    sock.on("close", () => finish(() => reject(new CallFailed("connection closed without an answer", written))));
  });
}
