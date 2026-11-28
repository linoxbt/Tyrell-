export const dynamic = "force-dynamic";

/**
 * Proxies a control process's read-only view (TYRELL_API_URL), server-side, so the console can show a
 * self-hosted deployment. Without one there is nothing to serve: the console then reads your account
 * from the chain, or connects to the control process on your own computer.
 */
export async function GET() {
  const api = process.env.TYRELL_API_URL;
  if (!api) return Response.json({ error: "no control process configured" }, { status: 404 });
  try {
    const r = await fetch(`${api.replace(/\/$/, "")}/api/view`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return Response.json({ error: `control answered HTTP ${r.status}` }, { status: 502 });
    return new Response(await r.text(), { headers: { "content-type": "application/json", "x-tyrell-source": "live" } });
  } catch (e) {
    return Response.json({ error: `control unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
