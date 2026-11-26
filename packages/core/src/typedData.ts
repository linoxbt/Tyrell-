import type { TypedDataToPrimitiveTypes } from "abitype";
import { hashStruct, hashTypedData, keccak256, toBytes, type Address, type Hex } from "viem";
import { MEMORY_TYPES, memoryDomain, type AnchorDomain, type MemoryStruct } from "./envelope.js";

/** EIP-712 struct hash of a Memory, equal to MemoryAnchor.hashMemory and the anchored structHash. */
export const memoryStructHash = (m: MemoryStruct): Hex =>
  hashStruct({ primaryType: "Memory", types: MEMORY_TYPES, data: m });

/** The digest a lane key signs for `m` on a given MemoryAnchor deployment. */
export const memoryDigest = (m: MemoryStruct, d: AnchorDomain): Hex =>
  hashTypedData({ domain: memoryDomain(d), types: MEMORY_TYPES, primaryType: "Memory", message: m });

/** Typed-data arguments for viem's signTypedData / recoverTypedDataAddress. */
export const memoryTypedData = (m: MemoryStruct, d: AnchorDomain) =>
  ({ domain: memoryDomain(d), types: MEMORY_TYPES, primaryType: "Memory", message: m }) as const;

// ------------------------------------------------------------------ TyrellLedger (contracts/src/TyrellLedger.sol)

export interface LedgerDomain {
  chainId: number;
  tyrellLedger: Address;
}

export const ledgerDomain = (d: LedgerDomain) =>
  ({ name: "TyrellLedger", version: "1", chainId: d.chainId, verifyingContract: d.tyrellLedger }) as const;

export const LEDGER_TYPES = {
  AddPayee: [
    { name: "payeeId", type: "bytes32" },
    { name: "addr", type: "address" },
    { name: "token", type: "address" },
    { name: "capPerTx", type: "uint128" },
    { name: "capPerDay", type: "uint128" },
    { name: "label", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  RemovePayee: [
    { name: "payeeId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  ReinstatePayee: [
    { name: "payeeId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  ReleaseQuarantine: [
    { name: "seedId", type: "uint256" },
    { name: "reasonCid", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  SeedQuarantine: [
    { name: "seedType", type: "uint8" },
    { name: "seedValue", type: "bytes32" },
    { name: "fromBlock", type: "uint64" },
    { name: "toBlock", type: "uint64" },
    { name: "reasonCid", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  SuspendPayee: [
    { name: "payeeId", type: "bytes32" },
    { name: "seedId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export type LedgerAction = keyof typeof LEDGER_TYPES;

/** Which lane must sign each ledger action (I-11). */
export const LEDGER_SIGNER_LANE: Record<LedgerAction, "user" | "control"> = {
  AddPayee: "user",
  RemovePayee: "user",
  ReinstatePayee: "user",
  ReleaseQuarantine: "user",
  SeedQuarantine: "control",
  SuspendPayee: "control",
};

/** The message shape of each ledger action, e.g. LedgerMessage<"AddPayee">. */
export type LedgerMessage<A extends LedgerAction> = TypedDataToPrimitiveTypes<typeof LEDGER_TYPES>[A];

/** Typed-data arguments for a ledger action, ready for signTypedData. */
export function ledgerTypedData<A extends LedgerAction>(action: A, message: LedgerMessage<A>, d: LedgerDomain) {
  return {
    domain: ledgerDomain(d),
    types: { [action]: LEDGER_TYPES[action] } as { [K in A]: (typeof LEDGER_TYPES)[K] },
    primaryType: action,
    message,
  } as const;
}

export const ledgerStructHash = <A extends LedgerAction>(action: A, message: LedgerMessage<A>): Hex =>
  // TypeScript cannot correlate `action` with its message type here; the public signature enforces it.
  hashStruct({ primaryType: action, types: LEDGER_TYPES, data: message } as unknown as Parameters<typeof hashStruct>[0]);

/** Stable payee ID from a human label, e.g. payeeIdOf("landlord"). */
export const payeeIdOf = (label: string): Hex => keccak256(toBytes(`payee:${label}`));
