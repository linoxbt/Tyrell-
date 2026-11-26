import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Where sealed memory blobs live. There is deliberately no delete or unpin method on any store
 * (I-7, NFR-07): evidence stays pinned forever.
 */
export interface BlobStore {
  readonly name: string;
  put(bytes: Uint8Array): Promise<string>;
  get(cid: string): Promise<Uint8Array>;
}

export class BlobUnavailable extends Error {}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** CIDv1, raw codec, sha2-256, base32 ("bafkrei..."): the CID IPFS gives a single small raw block. */
export function cidOf(bytes: Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest();
  return "b" + base32(new Uint8Array([0x01, 0x55, 0x12, 0x20, ...digest]));
}

/** If `cid` is a raw sha2-256 CID, check the bytes match it (a lying gateway is caught here). */
export const matchesCid = (cid: string, bytes: Uint8Array): boolean => !cid.startsWith("bafkrei") || cidOf(bytes) === cid;

/** In-memory store for tests. */
export class MemoryBlobStore implements BlobStore {
  readonly name = "memory";
  private readonly blobs = new Map<string, Uint8Array>();
  async put(bytes: Uint8Array): Promise<string> {
    const cid = cidOf(bytes);
    this.blobs.set(cid, new Uint8Array(bytes));
    return cid;
  }
  async get(cid: string): Promise<Uint8Array> {
    const b = this.blobs.get(cid);
    if (!b) throw new BlobUnavailable(`${cid} not found`);
    return new Uint8Array(b);
  }
  /** Test helper: replace the bytes behind a CID, as a malicious gateway might (T-05). */
  tamper(cid: string, bytes: Uint8Array): void {
    this.blobs.set(cid, new Uint8Array(bytes));
  }
}

/** A directory of files named by CID: local development and offline demos. */
export class DirBlobStore implements BlobStore {
  readonly name = "dir";
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  async put(bytes: Uint8Array): Promise<string> {
    const cid = cidOf(bytes);
    const path = join(this.dir, cid);
    if (!existsSync(path)) writeFileSync(path, bytes, { flag: "wx" });
    return cid;
  }
  async get(cid: string): Promise<Uint8Array> {
    if (!/^[a-z0-9]+$/.test(cid)) throw new BlobUnavailable("invalid cid");
    const path = join(this.dir, cid);
    if (!existsSync(path)) throw new BlobUnavailable(`${cid} not found`);
    const bytes = new Uint8Array(readFileSync(path));
    if (!matchesCid(cid, bytes)) throw new BlobUnavailable(`${cid} content does not match its cid`);
    return bytes;
  }
}

export interface PinataOptions {
  jwt: string;
  /** Dedicated gateway, e.g. https://example.mypinata.cloud */
  gateway?: string;
  /** Tried in order after the dedicated gateway (spec section 11). */
  fallbackGateways?: string[];
  timeoutMs?: number;
  maxBytes?: number;
  fetch?: typeof fetch;
}

/** Pinata pinning (v3 Files API) with gateway reads and fallbacks. */
export class PinataBlobStore implements BlobStore {
  readonly name = "pinata";
  private readonly f: typeof fetch;
  private readonly gateways: string[];
  constructor(private readonly o: PinataOptions) {
    this.f = o.fetch ?? fetch;
    this.gateways = [o.gateway, ...(o.fallbackGateways ?? ["https://ipfs.io", "https://dweb.link"])]
      .filter((g): g is string => !!g)
      .map((g) => g.replace(/\/$/, ""));
  }

  async put(bytes: Uint8Array): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([bytes]), "tyrell-memory.bin");
    form.append("network", "public");
    const res = await this.f("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.o.jwt}` },
      body: form,
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 30_000),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { cid?: string } };
    if (!res.ok || !body.data?.cid) throw new Error(`Pinata upload failed: HTTP ${res.status}`);
    return body.data.cid;
  }

  async get(cid: string): Promise<Uint8Array> {
    if (!/^[a-zA-Z0-9]+$/.test(cid)) throw new BlobUnavailable("invalid cid");
    const errors: string[] = [];
    for (const g of this.gateways) {
      try {
        const res = await this.f(`${g}/ipfs/${cid}`, { signal: AbortSignal.timeout(this.o.timeoutMs ?? 15_000), redirect: "error" });
        if (!res.ok) {
          errors.push(`${g}: HTTP ${res.status}`);
          continue;
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length > (this.o.maxBytes ?? 65_536)) {
          errors.push(`${g}: too large`);
          continue;
        }
        if (!matchesCid(cid, buf)) {
          errors.push(`${g}: content does not match cid`);
          continue;
        }
        return buf;
      } catch (e) {
        errors.push(`${g}: ${(e as Error).message}`);
      }
    }
    throw new BlobUnavailable(errors.join("; "));
  }
}
