import { createPublicClient, createTestClient, getAddress, http, keccak256, toBytes, type PublicClient } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startChainlab, type Chainlab } from "../../../test/support/anvil.js";
import { ChainInconsistent, readSnapshot } from "../src/readers.js";

/*
 * The two-endpoint cross-check (S-4, M-4, perf 2) against a real chain, with a lying endpoint simulated
 * by a client that rewrites one old event. Before, only the last 5,000-block window was compared, so an
 * old forged user-lane key passed; now every field of the whole history is compared.
 */

let lab: Chainlab;
const honest = (): PublicClient => createPublicClient({ chain: lab.chain, transport: http(lab.url) }) as PublicClient;
const FAKE_KEY = getAddress(keccak256(toBytes("forged user key")).slice(0, 42));

/** A client that rewrites the user lane's LaneKeyAdded event: the "add a fake user-lane key" attack. */
function liar(): PublicClient {
  const c = honest();
  return new Proxy(c, {
    get(t, prop, recv) {
      if (prop !== "getContractEvents") return Reflect.get(t, prop, recv);
      return async (args: Parameters<PublicClient["getContractEvents"]>[0]) => {
        const logs = (await t.getContractEvents(args)) as Array<{ eventName?: string; args: Record<string, unknown> }>;
        return logs.map((l) => (l.eventName === "LaneKeyAdded" && Number(l.args.lane) === 1 ? { ...l, args: { ...l.args, key: FAKE_KEY } } : l));
      };
    },
  });
}

const mine = (n: number) => createTestClient({ chain: lab.chain, mode: "anvil", transport: http(lab.url) }).mine({ blocks: n });

beforeAll(async () => {
  lab = await startChainlab();
  await mine(30);
}, 120_000);
afterAll(() => lab?.stop());

describe("readSnapshot cross-check", () => {
  it("honest endpoints agree", async () => {
    const s = await readSnapshot([honest(), honest()], lab.deployment, { confirmations: 0n });
    expect(s.laneEvents.filter((e) => e.kind === "added")).toHaveLength(4);
  });

  it("a forged event far outside the last window is caught (the whole history is compared)", async () => {
    const err = await readSnapshot([liar(), honest()], lab.deployment, { confirmations: 0n, window: 2n }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChainInconsistent);
    expect((err as ChainInconsistent).code).toBe("CHAIN_INCONSISTENT");
    expect((err as Error).message).toMatch(/disagree on chain state/);
  });

  it("a third endpoint breaks the tie in favour of the two that agree", async () => {
    const s = await readSnapshot([liar(), honest(), honest()], lab.deployment, { confirmations: 0n, window: 2n });
    expect(s.laneEvents.some((e) => e.key === FAKE_KEY)).toBe(false);
    expect(s.laneEvents.find((e) => e.lane === 1)!.key).toBe(lab.lanes.user.address);
    // it is two of three: endpoints are chosen from independent operators for that reason
    const two = await readSnapshot([liar(), honest(), liar()], lab.deployment, { confirmations: 0n });
    expect(two.laneEvents.some((e) => e.key === FAKE_KEY)).toBe(true);
  });

  it("an incremental read equals a full read, and a changed prefix falls back to a full read", async () => {
    const first = await readSnapshot([honest(), honest()], lab.deployment, { confirmations: 0n });
    await mine(5);
    const full = await readSnapshot([honest(), honest()], lab.deployment, { confirmations: 0n });
    const inc = await readSnapshot([honest(), honest()], lab.deployment, { confirmations: 0n, since: first });
    const norm = (x: typeof full) => JSON.stringify({ ...x, laneEvents: [...x.laneEvents].sort((a, b) => Number(a.pos.block - b.pos.block) || a.pos.logIndex - b.pos.logIndex) }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(norm(inc)).toBe(norm(full));
    // a "since" whose head block is no longer canonical (a reorg) is ignored
    const stale = { ...first, headHash: keccak256(toBytes("other fork")), laneEvents: [] };
    expect(norm(await readSnapshot([honest(), honest()], lab.deployment, { confirmations: 0n, since: stale }))).toBe(norm(full));
  });
});
