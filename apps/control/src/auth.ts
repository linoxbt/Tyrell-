import type { Hex, PublicClient } from "viem";
import { LANE_NAMES, recoverRequest, type Lane, type RequestAuth } from "@tyrell/core";
import { laneRegistryAbi, type Deployment } from "@tyrell/chain";

export class Unauthorized extends Error {}

/**
 * Checks signed requests on control's socket (S-6): the signer must be the active key of one of the
 * lanes allowed for that request, the request unexpired, and its nonce unseen.
 */
export class RequestGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly deployment: Deployment,
    private readonly client: PublicClient,
    private readonly now: () => number = Date.now,
  ) {}

  async check(req: Record<string, unknown> & { auth?: RequestAuth }, lanes: readonly Lane[]): Promise<{ by: Hex; lane: Lane }> {
    const t = this.now();
    for (const [n, exp] of this.seen) if (exp * 1000 < t) this.seen.delete(n);
    let by: Hex;
    try {
      by = await recoverRequest(this.deployment.acct, req, t);
    } catch (e) {
      throw new Unauthorized((e as Error).message);
    }
    const nonce = req.auth!.nonce.toLowerCase();
    if (this.seen.has(nonce)) throw new Unauthorized("request replayed");
    for (const lane of lanes) {
      const active = await this.client.readContract({ address: this.deployment.laneRegistry, abi: laneRegistryAbi, functionName: "isActiveFor", args: [by, lane] });
      if (active) {
        this.seen.set(nonce, req.auth!.expires);
        return { by, lane };
      }
    }
    throw new Unauthorized(`${by} is not the active ${lanes.map((l) => LANE_NAMES[l]).join(" or ")} key`);
  }
}

/**
 * The memories control served each Steward turn through recall. A proposal's decision cites them all,
 * whatever readSet the proposal claims, so a turn cannot read a memory and then leave it out (S-6).
 */
export class ServedLedger {
  private readonly turns = new Map<string, { at: number; ids: Set<string> }>();
  constructor(private readonly ttlMs = 3_600_000) {}

  add(turn: string, ids: Iterable<string>, now = Date.now()): void {
    for (const [k, v] of this.turns) if (now - v.at > this.ttlMs) this.turns.delete(k);
    const e = this.turns.get(turn) ?? { at: now, ids: new Set<string>() };
    for (const id of ids) e.ids.add(id.toLowerCase());
    e.at = now;
    this.turns.set(turn, e);
  }

  /** readSet plus everything served to `turn`, sorted. */
  complete(turn: string, readSet: readonly string[]): string[] {
    const all = new Set(readSet.map((x) => x.toLowerCase()));
    for (const id of this.turns.get(turn)?.ids ?? []) all.add(id);
    return [...all].sort();
  }
}
