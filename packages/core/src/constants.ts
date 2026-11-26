/** Lane IDs, as registered in LaneRegistry (spec section 5). */
export const Lane = { User: 1, Agent: 2, Wallet: 3, Control: 4 } as const;
export type Lane = (typeof Lane)[keyof typeof Lane];
export const LANE_NAMES: Record<Lane, string> = { 1: "user", 2: "agent", 3: "wallet", 4: "control" };

/** Memory kinds (spec section 6). */
export const Kind = { Statement: 1, Observation: 2, Note: 3, Summary: 4, Decision: 5 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

/** Trust classes, highest first (spec section 5). Quarantine is a separate flag. */
export const TRUST_CLASSES = ["trusted", "derived", "untrusted", "unverified"] as const;
export type TrustClass = (typeof TRUST_CLASSES)[number];

/** Rank for "lowest class wins": higher number = lower trust. */
export const TRUST_RANK: Record<TrustClass, number> = { trusted: 0, derived: 1, untrusted: 2, unverified: 3 };

export const NAMESPACES = ["steward.mem", "tyrell.control"] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const ENVELOPE_VERSION = 1;
export const MAX_PARENTS = 64;
export const MAX_BODY_BYTES = 8192;

/** Quarantine seed types, as stored by TyrellLedger. */
export const SeedType = { Memory: 1, Source: 2, SignerWindow: 3, Turn: 4 } as const;
export type SeedType = (typeof SeedType)[keyof typeof SeedType];
