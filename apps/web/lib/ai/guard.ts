/*
 * The live demo spends the site owner's model credits, so it is fenced: preset runs are cached, every
 * visitor gets a few runs, and the whole site a few per minute (Fortytwo allows 20 requests a minute and a
 * run makes about six). Each model call is also capped in tokens and time (lib/ai/demo.ts).
 *
 * The counters live in the server instance by default, which is best effort: a cold start or a second
 * instance starts from zero. Setting KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV / Upstash Redis, the
 * same REST API; UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN also work) shares them across instances.
 * Either way, the key's own spend limit at the provider is the real ceiling, and the owner should set one.
 */

export const LIMITS = { perVisitor: 4, visitorWindowMs: 10 * 60_000, perMinute: 3, cacheMs: 30 * 60_000, maxVisitors: 5000 };

export type Gate = { ok: true } | { ok: false; retryAfter: number; reason: string };

const visits = new Map<string, number[]>();
let recent: number[] = [];

/** In-memory limiter (one server instance). */
export function admit(visitor: string, now = Date.now()): Gate {
  recent = recent.filter((t) => now - t < 60_000);
  const mine = (visits.get(visitor) ?? []).filter((t) => now - t < LIMITS.visitorWindowMs);
  if (mine.length >= LIMITS.perVisitor) return { ok: false, retryAfter: Math.ceil((mine[0]! + LIMITS.visitorWindowMs - now) / 1000), reason: "You have used your live runs for now." };
  if (recent.length >= LIMITS.perMinute) return { ok: false, retryAfter: Math.ceil((recent[0]! + 60_000 - now) / 1000), reason: "The live demo is busy." };
  mine.push(now);
  recent.push(now);
  visits.delete(visitor);
  visits.set(visitor, mine);
  if (visits.size > LIMITS.maxVisitors) {
    // drop visitors whose window has passed, then the least recent ones; never reset everybody at once
    for (const [v, ts] of visits) if (!ts.some((t) => now - t < LIMITS.visitorWindowMs)) visits.delete(v);
    for (const v of visits.keys()) {
      if (visits.size <= LIMITS.maxVisitors) break;
      visits.delete(v);
    }
  }
  return { ok: true };
}

/** The shared store, when one is configured. */
function store(env: Record<string, string | undefined>): { url: string; token: string } | undefined {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : undefined;
}

/**
 * Fixed-window counters in Redis (INCR + EXPIRE): `perVisitor` per visitor per window, `perMinute` for the
 * whole site. Falls back to the in-memory limiter when no store is configured or the store fails.
 */
export async function admitShared(visitor: string, env: Record<string, string | undefined> = process.env, f: typeof fetch = fetch, now = Date.now()): Promise<Gate> {
  const s = store(env);
  if (!s) return admit(visitor, now);
  const vWin = Math.floor(now / LIMITS.visitorWindowMs);
  const mWin = Math.floor(now / 60_000);
  const vKey = `tyrell:ai:v:${visitor}:${vWin}`;
  const mKey = `tyrell:ai:m:${mWin}`;
  try {
    const r = await f(`${s.url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCR", vKey],
        ["EXPIRE", vKey, String(Math.ceil(LIMITS.visitorWindowMs / 1000))],
        ["INCR", mKey],
        ["EXPIRE", mKey, "60"],
      ]),
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const out = (await r.json()) as Array<{ result?: number }>;
    const vCount = Number(out[0]?.result);
    const mCount = Number(out[2]?.result);
    if (!Number.isFinite(vCount) || !Number.isFinite(mCount)) throw new Error("unexpected reply");
    if (vCount > LIMITS.perVisitor) return { ok: false, retryAfter: Math.ceil(((vWin + 1) * LIMITS.visitorWindowMs - now) / 1000), reason: "You have used your live runs for now." };
    if (mCount > LIMITS.perMinute) return { ok: false, retryAfter: Math.ceil(((mWin + 1) * 60_000 - now) / 1000), reason: "The live demo is busy." };
    return { ok: true };
  } catch {
    return admit(visitor, now);
  }
}

const cache = new Map<string, { at: number; value: unknown }>();
export function cached<T>(key: string, now = Date.now()): T | undefined {
  const hit = cache.get(key);
  return hit && now - hit.at < LIMITS.cacheMs ? (hit.value as T) : undefined;
}
export function remember(key: string, value: unknown, now = Date.now()) {
  if (cache.size > 50) cache.clear();
  cache.set(key, { at: now, value });
}

/**
 * POSTs must come from this site's own pages: a JSON body (which a plain cross-site form cannot send) and,
 * when the browser says where the request came from, the same origin. Returns a reason when refused.
 */
export function sameOriginJson(req: Request): string | undefined {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) return "the body must be JSON";
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return "cross-site requests are not accepted";
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    let from: string;
    try {
      from = new URL(origin).host;
    } catch {
      return "bad origin";
    }
    if (from !== host) return "cross-site requests are not accepted";
  }
  return undefined;
}

/** For tests. */
export function resetGuard() {
  visits.clear();
  recent = [];
  cache.clear();
}
