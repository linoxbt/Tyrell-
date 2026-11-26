/** Lane IDs, as registered in LaneRegistry (section 5). */
export const Lane = { User: 1, Agent: 2, Wallet: 3, Control: 4 } as const;
export type Lane = (typeof Lane)[keyof typeof Lane];

/** Memory kinds (section 6). */
export const Kind = { Statement: 1, Observation: 2, Note: 3, Summary: 4, Decision: 5 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

/** Trust classes, highest first (section 5). Quarantine is a separate flag. */
export const TRUST_CLASSES = ["trusted", "derived", "untrusted", "unverified"] as const;
export type TrustClass = (typeof TRUST_CLASSES)[number];

export const ENVELOPE_VERSION = 1;
export const MAX_PARENTS = 64;
export const MAX_BODY_BYTES = 8192;
