import type { Address } from "viem";

/** A position on chain: block number, then log index within the block. */
export interface ChainPos {
  block: bigint;
  logIndex: number;
}

export const comparePos = (a: ChainPos, b: ChainPos): number =>
  a.block < b.block ? -1 : a.block > b.block ? 1 : a.logIndex - b.logIndex;

/** A LaneKeyAdded or LaneKeyRevoked event from LaneRegistry. */
export interface LaneKeyEvent {
  kind: "added" | "revoked";
  lane: number;
  key: Address;
  pos: ChainPos;
}

interface Binding {
  lane: number;
  added: ChainPos;
  revoked?: ChainPos;
}

/**
 * Historical lane bindings rebuilt from LaneRegistry events (spec section 5, "Key binding at startup").
 * A memory signed by a since-revoked key still binds to its lane if it was anchored before the revoke.
 */
export class KeyHistory {
  private readonly bindings = new Map<string, Binding>();

  constructor(events: readonly LaneKeyEvent[]) {
    for (const e of [...events].sort((a, b) => comparePos(a.pos, b.pos))) {
      const k = e.key.toLowerCase();
      const b = this.bindings.get(k);
      if (e.kind === "added") {
        if (b) throw new Error(`key ${e.key} added twice: LaneRegistry forbids this`);
        this.bindings.set(k, { lane: e.lane, added: e.pos });
      } else {
        if (!b || b.revoked) throw new Error(`revoke of unknown or already revoked key ${e.key}`);
        b.revoked = e.pos;
      }
    }
  }

  /** The lane `key` was bound to at `pos`, or undefined if it was not active then. */
  laneAt(key: Address, pos: ChainPos): number | undefined {
    const b = this.bindings.get(key.toLowerCase());
    if (!b || comparePos(pos, b.added) < 0) return undefined;
    if (b.revoked && comparePos(pos, b.revoked) >= 0) return undefined;
    return b.lane;
  }

  /** Currently active key per lane. */
  activeKeys(): Map<number, Address> {
    const out = new Map<number, Address>();
    for (const [key, b] of this.bindings) if (!b.revoked) out.set(b.lane, key as Address);
    return out;
  }

  /** Startup rule: exactly one active key per lane, for all four lanes. */
  assertOneActiveKeyPerLane(): void {
    const active = this.activeKeys();
    for (const lane of [1, 2, 3, 4]) if (!active.has(lane)) throw new Error(`lane ${lane} has no active key: refusing to start`);
  }
}
