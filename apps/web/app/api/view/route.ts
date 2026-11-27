import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

/**
 * Serves the view document. With TYRELL_API_URL set it proxies control's read-only API (server-side,
 * so the browser never reaches control); otherwise it serves public/snapshot.json (read-only demo).
 */
export async function GET() {
  const api = process.env.TYRELL_API_URL;
  if (api) {
    try {
      const r = await fetch(`${api.replace(/\/$/, "")}/api/view`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (r.ok) return new Response(await r.text(), { headers: { "content-type": "application/json", "x-tyrell-source": "live" } });
    } catch {
      /* fall through to the snapshot */
    }
  }
  try {
    const text = await readFile(join(process.cwd(), "public", "snapshot.json"), "utf8");
    return new Response(text, { headers: { "content-type": "application/json", "x-tyrell-source": "snapshot" } });
  } catch {
    return Response.json({ error: "no live API (TYRELL_API_URL) and no public/snapshot.json" }, { status: 503 });
  }
}
