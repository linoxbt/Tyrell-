import { keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  KeyHistory,
  memoryStructHash,
  memoryTypedData,
  toMemoryStruct,
  bodyLenOf,
  ZERO_ID16,
  type AnchorRecord,
  type Header,
  type Id16,
  type LaneKeyEvent,
  type SrcRef,
  type VerifyContext,
  type Namespace,
} from "../src/index.js";

// Test keys are derived from labels at runtime so no key-shaped literal lands in git.
const key = (label: string): Hex => keccak256(toBytes(`tyrell-test-key:${label}`));
export const accounts = {
  user: privateKeyToAccount(key("user")),
  agent: privateKeyToAccount(key("agent")),
  wallet: privateKeyToAccount(key("wallet")),
  control: privateKeyToAccount(key("control")),
  stranger: privateKeyToAccount(key("stranger")),
  agent2: privateKeyToAccount(key("agent2")),
};
export const laneAccount: Record<number, PrivateKeyAccount> = { 1: accounts.user, 2: accounts.agent, 3: accounts.wallet, 4: accounts.control };

export const ACCT = keccak256(toBytes("tyrell-test-account"));
export const DOMAIN = { chainId: 1983, memoryAnchor: "0x000000000000000000000000000000000000dEaD" as Address };

export const laneEvents: LaneKeyEvent[] = [1, 2, 3, 4].map((lane, i) => ({
  kind: "added" as const,
  lane,
  key: laneAccount[lane]!.address,
  pos: { block: 1n, logIndex: i },
}));
export const ctx = (events: LaneKeyEvent[] = laneEvents): VerifyContext => ({ acct: ACCT, domain: DOMAIN, keys: new KeyHistory(events) });

let counter = 0;
export const resetCounter = () => {
  counter = 0;
};
export const id = (n: number): Id16 => `0x${n.toString(16).padStart(32, "0")}` as Id16;

export interface Made {
  id: Id16;
  header: Header;
  body: string;
  blob: { header: Header; body: string; signature: Hex };
  anchor: AnchorRecord;
}

export interface MakeOpts {
  lane: number;
  kind?: number;
  parents?: Id16[];
  src?: SrcRef[];
  body?: string;
  turn?: Id16;
  ns?: Namespace;
  signer?: PrivateKeyAccount;
  id?: Id16;
  block?: bigint;
  refBlock?: number;
  bodyLen?: number;
}

/** Builds, signs and "anchors" a memory the way control would. Each call lands in a later block. */
export async function make(o: MakeOpts): Promise<Made> {
  counter += 1;
  const body = o.body ?? `memory ${counter}`;
  const header: Header = {
    v: 1,
    id: o.id ?? id(1000 + counter),
    acct: ACCT,
    ns: o.ns ?? "steward.mem",
    lane: o.lane,
    kind: o.kind ?? (o.lane === 3 ? 2 : o.lane === 4 ? 5 : o.lane === 1 ? 1 : 3),
    parents: [...(o.parents ?? [])].sort(),
    src: o.src ?? [],
    turn: o.turn ?? ZERO_ID16,
    refBlock: o.refBlock ?? 10,
    ts: "2026-11-27T10:00:00Z",
    bodyLen: o.bodyLen ?? bodyLenOf(body),
  };
  const signer = o.signer ?? laneAccount[o.lane]!;
  const struct = toMemoryStruct(header, body);
  const signature = await signer.signTypedData(memoryTypedData(struct, DOMAIN));
  const anchor: AnchorRecord = {
    id: header.id,
    lane: o.lane,
    signer: signer.address,
    ns: struct.ns,
    structHash: memoryStructHash(struct),
    parentsHash: struct.parentsHash,
    bodyHash: struct.bodyHash,
    cid: `bafy${counter}`,
    refBlock: struct.refBlock,
    pos: { block: o.block ?? 100n + BigInt(counter), logIndex: 0 },
  };
  return { id: header.id, header, body, blob: { header, body, signature }, anchor };
}
