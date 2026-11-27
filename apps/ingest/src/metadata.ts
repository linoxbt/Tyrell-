import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { erc20Abi, type Address, type PublicClient } from "viem";

/**
 * Reads attacker-controlled metadata (spec section 10): ERC-20 name/symbol/decimals, NFT tokenURI or
 * uri JSON. Everything returned here is untrusted text; it is written to the wallet lane verbatim and
 * never interpreted. Fetching is bounded: 64 KB, 5 s, no redirects, no private or loopback addresses.
 */

const erc721Abi = [{ type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "string" }] }] as const;
const erc1155Abi = [{ type: "function", name: "uri", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "string" }] }] as const;

export interface TokenMeta {
  name?: string;
  symbol?: string;
  decimals?: number;
}

const clip = (s: string, n = 512) => (s.length > n ? s.slice(0, n) + "…" : s);

export async function erc20Meta(c: PublicClient, token: Address): Promise<TokenMeta> {
  const get = async <T>(fn: "name" | "symbol" | "decimals"): Promise<T | undefined> => {
    try {
      return (await c.readContract({ address: token, abi: erc20Abi, functionName: fn })) as T;
    } catch {
      return undefined;
    }
  };
  const [name, symbol, decimals] = await Promise.all([get<string>("name"), get<string>("symbol"), get<number>("decimals")]);
  return { ...(name !== undefined ? { name: clip(name) } : {}), ...(symbol !== undefined ? { symbol: clip(symbol, 64) } : {}), ...(decimals !== undefined ? { decimals } : {}) };
}

export async function nftUri(c: PublicClient, token: Address, id: bigint, standard: "erc721" | "erc1155"): Promise<string | undefined> {
  try {
    return standard === "erc721"
      ? await c.readContract({ address: token, abi: erc721Abi, functionName: "tokenURI", args: [id] })
      : (await c.readContract({ address: token, abi: erc1155Abi, functionName: "uri", args: [id] })).replace("{id}", id.toString(16).padStart(64, "0"));
  } catch {
    return undefined;
  }
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
}

export interface FetchMetaOptions {
  ipfsGateway?: string;
  maxBytes?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** DNS resolver (tests inject one). */
  resolve?: (host: string) => Promise<string[]>;
}

/** Fetches metadata JSON (data:, https:, ipfs:) within the limits. Returns raw text or an error note. */
export async function fetchMetadata(uri: string, o: FetchMetaOptions = {}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const max = o.maxBytes ?? 65_536;
  if (uri.startsWith("data:")) {
    const m = /^data:([^,;]*)(;base64)?,(.*)$/s.exec(uri);
    if (!m) return { ok: false, error: "malformed data URI" };
    const text = m[2] ? Buffer.from(m[3]!, "base64").toString("utf8") : decodeURIComponent(m[3]!);
    return text.length > max ? { ok: false, error: "too large" } : { ok: true, text };
  }
  let url: URL;
  try {
    url = new URL(uri.startsWith("ipfs://") ? `${(o.ipfsGateway ?? "https://ipfs.io").replace(/\/$/, "")}/ipfs/${uri.slice(7).replace(/^ipfs\//, "")}` : uri);
  } catch {
    return { ok: false, error: "invalid URI" };
  }
  if (url.protocol !== "https:") return { ok: false, error: `refusing ${url.protocol} URL` };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [host] : await (o.resolve ?? (async (h) => (await lookup(h, { all: true })).map((r) => r.address)))(host).catch(() => [] as string[]);
  if (ips.length === 0) return { ok: false, error: "host does not resolve" };
  if (ips.some(isPrivateIp)) return { ok: false, error: "refusing private or loopback address" };
  try {
    const res = await (o.fetch ?? fetch)(url, { redirect: "manual", signal: AbortSignal.timeout(o.timeoutMs ?? 5_000) });
    if (res.status >= 300 && res.status < 400) return { ok: false, error: "refusing redirect" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, error: "no body" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        return { ok: false, error: "too large" };
      }
      chunks.push(value);
    }
    return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message };
  }
}

/** Pulls the human-readable fields out of NFT metadata JSON; falls back to the raw text. */
export function metadataText(raw: string): string[] {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const out = ["name", "description", "external_url", "image"].map((k) => j[k]).filter((v): v is string => typeof v === "string");
    if (Array.isArray(j.attributes)) for (const a of j.attributes as Array<Record<string, unknown>>) if (typeof a?.value === "string") out.push(a.value);
    return out.map((s) => clip(s, 1024));
  } catch {
    return [clip(raw, 1024)];
  }
}
