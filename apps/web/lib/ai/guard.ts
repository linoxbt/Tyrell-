/*
 * The live demo spends the site owner's model credits, so it is fenced: preset runs are cached, every
 * visitor gets a few runs, and the whole site a few per minute (Fortytwo allows 20 requests a minute and a
 * run makes about six). Counters live in the server instance: best effort, backed by the key's own spend
 * limit, which the owner should set.
 */

export const LIMITS = { perVisitor: 4, visitorWindowMs: 10 * 60_000, perMinute: 3, cacheMs: 30 * 60_000 };

const visits = new Map<string, number[]>();
let recent: number[] = [];

export function admit(visitor: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number; reason: string } {
  recent = recent.filter((t) => now - t < 60_000);
  const mine = (visits.get(visitor) ?? []).filter((t) => now - t < LIMITS.visitorWindowMs);
  if (mine.length >= LIMITS.perVisitor) return { ok: false, retryAfter: Math.ceil((mine[0]! + LIMITS.visitorWindowMs - now) / 1000), reason: "You have used your live runs for now." };
  if (recent.length >= LIMITS.perMinute) return { ok: false, retryAfter: Math.ceil((recent[0]! + 60_000 - now) / 1000), reason: "The live demo is busy." };
  mine.push(now);
  recent.push(now);
  visits.set(visitor, mine);
  if (visits.size > 5000) visits.clear();
  return { ok: true };
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

/** For tests. */
export function resetGuard() {
  visits.clear();
  recent = [];
  cache.clear();
}
