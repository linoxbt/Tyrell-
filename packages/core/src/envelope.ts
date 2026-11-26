import { z } from "zod";
import { concat, keccak256, toBytes, type Address, type Hex } from "viem";
import { canonicalHash } from "./canonical.js";
import { ENVELOPE_VERSION, MAX_BODY_BYTES, MAX_PARENTS, NAMESPACES, type Namespace } from "./constants.js";
import { isId16, ZERO_ID16, type Id16 } from "./ids.js";

const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/, "expected 32-byte lowercase hex");
const id16 = z.string().refine(isId16, "expected 16-byte lowercase hex") as unknown as z.ZodType<Id16>;
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const txHash = hex32;

/** Origin references (spec section 6, `src`). Unknown fields are rejected so src hashes stay stable. */
export const SrcRef = z.discriminatedUnion("t", [
  z.object({ t: z.literal("erc20"), addr: evmAddress, tx: txHash.optional(), from: evmAddress.optional() }).strict(),
  z.object({ t: z.literal("nft"), addr: evmAddress, tokenId: z.string().regex(/^\d+$/), tx: txHash.optional(), from: evmAddress.optional() }).strict(),
  z.object({ t: z.literal("transfer"), addr: evmAddress, tx: txHash, from: evmAddress }).strict(),
  z.object({ t: z.literal("mcp"), tool: z.string().min(1).max(64), args: z.record(z.unknown()) }).strict(),
  z.object({ t: z.literal("user-msg"), id: z.string().min(1).max(64) }).strict(),
  z.object({ t: z.literal("external"), url: z.string().max(2048).optional(), note: z.string().max(256).optional() }).strict(),
]);
export type SrcRef = z.infer<typeof SrcRef>;

/** Full envelope header, stored encrypted off-chain (spec section 6). */
export const Header = z
  .object({
    v: z.literal(ENVELOPE_VERSION),
    id: id16,
    acct: hex32,
    ns: z.enum(NAMESPACES),
    lane: z.number().int().min(1).max(4),
    kind: z.number().int().min(1).max(5),
    parents: z.array(id16).max(MAX_PARENTS),
    src: z.array(SrcRef).max(32),
    turn: id16,
    refBlock: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ts: z.string().datetime({ offset: true }),
    bodyLen: z.number().int().nonnegative().max(MAX_BODY_BYTES),
  })
  .strict()
  .superRefine((h, ctx) => {
    for (let i = 1; i < h.parents.length; i++) {
      if (h.parents[i - 1]! >= h.parents[i]!) {
        ctx.addIssue({ code: "custom", path: ["parents"], message: "parents must be sorted and unique" });
        break;
      }
    }
    if (h.parents.includes(h.id)) ctx.addIssue({ code: "custom", path: ["parents"], message: "a memory cannot be its own parent" });
    if (h.id === ZERO_ID16) ctx.addIssue({ code: "custom", path: ["id"], message: "zero id" });
  });
export type Header = z.infer<typeof Header>;

/** What is encrypted and pinned: header, body and the lane key's EIP-712 signature. */
export const Blob = z.object({ header: Header, body: z.string(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict();
export type Blob = z.infer<typeof Blob>;

/** The struct the lane key signs and MemoryAnchor stores (contracts/src/MemoryAnchor.sol). */
export interface MemoryStruct {
  id: Id16;
  acct: Hex;
  ns: Hex;
  lane: number;
  kind: number;
  parentsHash: Hex;
  srcHash: Hex;
  turn: Id16;
  refBlock: bigint;
  bodyHash: Hex;
  bodyLen: number;
}

export const MEMORY_TYPES = {
  Memory: [
    { name: "id", type: "bytes16" },
    { name: "acct", type: "bytes32" },
    { name: "ns", type: "bytes32" },
    { name: "lane", type: "uint8" },
    { name: "kind", type: "uint8" },
    { name: "parentsHash", type: "bytes32" },
    { name: "srcHash", type: "bytes32" },
    { name: "turn", type: "bytes16" },
    { name: "refBlock", type: "uint64" },
    { name: "bodyHash", type: "bytes32" },
    { name: "bodyLen", type: "uint32" },
  ],
} as const;

export interface AnchorDomain {
  chainId: number;
  memoryAnchor: Address;
}

export const memoryDomain = (d: AnchorDomain) =>
  ({ name: "Tyrell", version: "1", chainId: d.chainId, verifyingContract: d.memoryAnchor }) as const;

export const nsHash = (ns: Namespace): Hex => keccak256(toBytes(ns));
export const bodyHashOf = (body: string): Hex => keccak256(toBytes(body));
export const bodyLenOf = (body: string): number => toBytes(body).length;
/** keccak256(abi.encodePacked(sorted parent ids)); parents are sorted by the schema. */
export const parentsHashOf = (parents: readonly Id16[]): Hex => keccak256(parents.length ? concat([...parents]) : "0x");
export const srcHashOf = (src: readonly SrcRef[]): Hex => canonicalHash(src);

export function toMemoryStruct(h: Header, body: string): MemoryStruct {
  return {
    id: h.id,
    acct: h.acct as Hex,
    ns: nsHash(h.ns),
    lane: h.lane,
    kind: h.kind,
    parentsHash: parentsHashOf(h.parents),
    srcHash: srcHashOf(h.src),
    turn: h.turn,
    refBlock: BigInt(h.refBlock),
    bodyHash: bodyHashOf(body),
    bodyLen: h.bodyLen,
  };
}

/** Sorts and de-duplicates parent IDs, as the runtime must before signing (I-3). */
export const normaliseParents = (ids: Iterable<Id16>): Id16[] => [...new Set([...ids].map((s) => s.toLowerCase() as Id16))].sort();
