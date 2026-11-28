import { keccak256, recoverMessageAddress, toBytes, type Address, type Hex } from "viem";
import type { LocalAccount } from "viem/accounts";
import { canonicalJson } from "./canonical.js";

/**
 * Authentication for requests a lane process sends control over the local socket (S-6). Node cannot
 * read a Unix socket peer's credentials, so the socket's file mode is not the boundary: a request that
 * makes control act (a payment proposal, a quarantine, an incident) carries an EIP-191 signature by
 * the sender's active lane key over the request itself, the account, a random nonce and an expiry.
 * Control checks the key is the active key of the lane that may send that request, and refuses a
 * nonce it has seen or an expired request.
 */
export interface RequestAuth {
  by: Address;
  nonce: Hex;
  /** Unix seconds. */
  expires: number;
  sig: Hex;
}

/** How long a signed request stays valid. */
export const REQUEST_AUTH_TTL = 120;

const TAG = "tyrell.ipc.request.v1";

/** The request as JSON sees it (bigints as {"$bigint": "…"}, as the IPC encoding sends them; undefined dropped). */
const jsonSafe = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? { $bigint: x.toString() } : x)) ?? "null");

export const requestAuthDigest = (acct: Hex, req: Record<string, unknown>, nonce: Hex, expires: number): Hex =>
  keccak256(toBytes(canonicalJson({ tag: TAG, acct: acct.toLowerCase(), nonce: nonce.toLowerCase(), expires, req: jsonSafe(req) })));

const randomNonce = (): Hex => `0x${[...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;

/** Signs `req` (everything but `auth`) for control. */
export async function signRequest<T extends Record<string, unknown>>(key: LocalAccount, acct: Hex, req: T, now = Date.now()): Promise<T & { auth: RequestAuth }> {
  const nonce = randomNonce();
  const expires = Math.floor(now / 1000) + REQUEST_AUTH_TTL;
  const sig = await key.signMessage({ message: { raw: requestAuthDigest(acct, req, nonce, expires) } });
  return { ...req, auth: { by: key.address, nonce, expires, sig } };
}

/** Recovers who signed a request, or throws if the signature, the signer or the expiry is wrong. */
export async function recoverRequest(acct: Hex, req: Record<string, unknown> & { auth?: RequestAuth }, now = Date.now()): Promise<Address> {
  const { auth, ...rest } = req;
  if (!auth) throw new Error("unsigned request: control accepts this only signed by a lane key");
  if (auth.expires < Math.floor(now / 1000)) throw new Error("request expired");
  if (auth.expires > Math.floor(now / 1000) + REQUEST_AUTH_TTL + 30) throw new Error("request expiry too far ahead");
  const from = await recoverMessageAddress({ message: { raw: requestAuthDigest(acct, rest, auth.nonce, auth.expires) }, signature: auth.sig });
  if (from.toLowerCase() !== auth.by.toLowerCase()) throw new Error("request signature does not match its sender");
  return from;
}
