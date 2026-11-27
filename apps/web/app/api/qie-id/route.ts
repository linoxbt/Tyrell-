import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi, zeroAddress } from "viem";

/**
 * Resolve a QIE ID on QIE mainnet straight from the QIE ID record store, the same contract AgentRegistry
 * verifies humans against. Read-only; used by the playground.
 */
const STORE = "0x8777d01d509D0eA71FB38F88F79867da558d5018" as const;
const abi = parseAbi(["function resolveCurrency(string domain_, string currency_) view returns (address)"]);
const RPCS = ["https://rpc5mainnet.qie.digital", "https://rpc1mainnet.qie.digital"];

export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get("name") ?? "").trim().toLowerCase();
  const name = raw.endsWith(".qie") ? raw : `${raw}.qie`;
  if (!/^[a-z0-9][a-z0-9-]{0,62}\.qie$/.test(name)) return NextResponse.json({ error: "a QIE ID is letters, digits and dashes, e.g. yourname.qie" }, { status: 400 });
  for (const url of RPCS) {
    try {
      const c = createPublicClient({ transport: http(url, { timeout: 8_000 }) });
      let address: string | null;
      let expired = false;
      try {
        const a = await c.readContract({ address: STORE, abi, functionName: "resolveCurrency", args: [name, "qie"] });
        address = a === zeroAddress ? null : a;
      } catch (e) {
        if (!/expired/i.test(String(e))) throw e;
        address = null;
        expired = true;
      }
      const block = await c.getBlockNumber();
      return NextResponse.json({ name, address, expired, store: STORE, chainId: 1990, block: block.toString(), rpc: url }, { headers: { "cache-control": "public, max-age=60" } });
    } catch {
      /* try the next endpoint */
    }
  }
  return NextResponse.json({ error: "QIE mainnet RPC unreachable right now" }, { status: 502 });
}
