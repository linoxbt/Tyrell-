import { keccak256, toBytes, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { Lane, signRequest } from "@tyrell/core";
import type { Deployment } from "@tyrell/chain";
import { RequestGuard, ServedLedger, Unauthorized } from "../src/auth.js";

const agent = privateKeyToAccount(keccak256(toBytes("guard-agent")));
const d = { acct: keccak256(toBytes("acct")), laneRegistry: "0x000000000000000000000000000000000000beef" } as unknown as Deployment;
/** LaneRegistry stand-in: `agent` is the active agent-lane key and nothing else is active. */
const registry = { readContract: async ({ args }: { args: [string, number] }) => args[0] === agent.address && args[1] === Lane.Agent } as unknown as PublicClient;

describe("RequestGuard (S-6)", () => {
  it("accepts the active lane key once, and refuses a replay or the wrong lane", async () => {
    const g = new RequestGuard(d, registry);
    const req = await signRequest(agent, d.acct, { type: "propose", turn: "0x01" });
    await expect(g.check(req, [Lane.Agent])).resolves.toMatchObject({ by: agent.address, lane: Lane.Agent });
    await expect(g.check(req, [Lane.Agent])).rejects.toThrow(/replayed/);
    const other = await signRequest(agent, d.acct, { type: "incident" });
    await expect(g.check(other, [Lane.Wallet])).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe("ServedLedger", () => {
  it("completes a proposal's readSet with everything served to its turn", () => {
    const s = new ServedLedger();
    s.add("t1", ["0xB", "0xa"]);
    expect(s.complete("t1", ["0xc"])).toEqual(["0xa", "0xb", "0xc"]);
    expect(s.complete("t2", ["0xc"])).toEqual(["0xc"]);
  });
});
