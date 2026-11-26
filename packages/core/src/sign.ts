import type { Hex } from "viem";
import type { LocalAccount } from "viem/accounts";
import { bodyLenOf, normaliseParents, toMemoryStruct, type AnchorDomain, type Blob, type Header, type SrcRef } from "./envelope.js";
import { ENVELOPE_VERSION, type Namespace } from "./constants.js";
import { uuidv7, ZERO_ID16, type Id16 } from "./ids.js";
import { memoryTypedData } from "./typedData.js";

export interface EnvelopeInput {
  acct: Hex;
  lane: number;
  kind: number;
  body: string;
  refBlock: bigint;
  ns?: Namespace;
  /** Set by the runtime from the turn's readSet, never by the model (I-3). */
  parents?: Iterable<Id16>;
  src?: SrcRef[];
  turn?: Id16;
  id?: Id16;
  now?: Date;
}

/** Builds and signs an envelope with a lane key (spec section 6, write path step 1). */
export async function signEnvelope(account: LocalAccount, domain: AnchorDomain, e: EnvelopeInput): Promise<Blob> {
  const now = e.now ?? new Date();
  const header: Header = {
    v: ENVELOPE_VERSION,
    id: e.id ?? uuidv7(now.getTime()),
    acct: e.acct.toLowerCase() as Hex,
    ns: e.ns ?? "steward.mem",
    lane: e.lane,
    kind: e.kind,
    parents: normaliseParents(e.parents ?? []),
    src: e.src ?? [],
    turn: e.turn ?? ZERO_ID16,
    refBlock: Number(e.refBlock),
    ts: now.toISOString(),
    bodyLen: bodyLenOf(e.body),
  };
  const signature = await account.signTypedData(memoryTypedData(toMemoryStruct(header, e.body), domain));
  return { header, body: e.body, signature };
}
