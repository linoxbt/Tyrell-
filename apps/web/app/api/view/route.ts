import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

/**
 * Serves the view document. With TYRELL_API_URL set it proxies control's read-only API (server-side,
 * so the browser never reaches control), sending TYRELL_API_TOKEN as a bearer token when set; otherwise
 * it serves public/snapshot.json (read-only demo). The console polls only in live mode: a snapshot does not
 * change while a deployment is up, so it is read once.
 */
export async function GET() {
  const api = process.env.TYRELL_API_URL;
  if (api) {
    try {
      const token = process.env.TYRELL_API_TOKEN;
      const r = await fetch(`${api.replace(/\/$/, "")}/api/view`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      });
      if (r.ok) return new Response(await r.text(), { headers: { "content-type": "application/json", "x-tyrell-source": "live" } });
    } catch {
      /* fall through to the snapshot */
    }
  }
  try {
    const text = await readFile(join(process.cwd(), "public", "snapshot.json"), "utf8");
    // without a live API the snapshot only changes with a new deployment, so the CDN may keep it
    const cache = api ? "no-store" : "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400";
    return new Response(text, { headers: { "content-type": "application/json", "x-tyrell-source": "snapshot", "cache-control": cache } });
  } catch {
    return Response.json({ error: "no live API (TYRELL_API_URL) and no public/snapshot.json" }, { status: 503 });
  }
}
