import { createConnection, createServer, type Server, type Socket } from "node:net";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { z } from "zod";

/**
 * Local IPC between Tyrell processes: newline-delimited JSON over a Unix domain socket (spec
 * section 13). Lane processes hand signed envelopes to control; they never share memory or keys.
 * Every request is parsed with zod before it reaches a handler.
 */

const blob = z.object({ header: z.record(z.unknown()), body: z.string(), signature: z.string() });

export const Request = z.discriminatedUnion("type", [
  z.object({ type: z.literal("submit"), blob }),
  z.object({ type: z.literal("submitBatch"), blobs: z.array(blob).min(1).max(20) }),
  z.object({ type: z.literal("status") }),
  z.object({ type: z.literal("recall"), query: z.string().max(512), limit: z.number().int().min(1).max(32).optional() }),
  z.object({ type: z.literal("show"), id: z.string().regex(/^0x[0-9a-f]{32}$/), forensic: z.boolean().optional() }),
  z.object({ type: z.literal("refresh") }),
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

export type Handler = (req: Request) => Promise<unknown>;

/** Serves requests on a Unix socket readable only by this OS user. */
export function serve(path: string, handler: Handler): Promise<Server> {
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
      parsed = Request.safeParse(decode(line));
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
      chmodSync(path, 0o600);
      resolve(server);
    });
  });
}

/** Sends one request and waits for its response. */
export function call(path: string, req: Request, timeoutMs = 120_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(path);
    let buf = "";
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("control did not answer in time"));
    }, timeoutMs);
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(encode(req) + "\n"));
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      clearTimeout(timer);
      sock.end();
      const r = decode(buf.slice(0, nl)) as Response;
      if (r.ok) resolve(r.result);
      else reject(new Error(r.error));
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
