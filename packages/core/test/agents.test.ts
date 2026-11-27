import { describe, expect, it } from "vitest";
import { getAddress, keccak256, toBytes, toHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AGENT_CODES,
  PERM,
  agentMessageSigner,
  checkAgent,
  codeText,
  dealPayeeId,
  messageBodyHash,
  payeeIdOf,
  permMask,
  permNames,
  signAgentMessage,
  type Verdict,
} from "../src/index.js";

const NET = getAddress(keccak256(toBytes("network")).slice(0, 42)) as Address;
const allow: Verdict = {
  decision: "ALLOW",
  code: "OK",
  reasons: ["R0-R4 passed"],
  payeeId: payeeIdOf("landlord"),
  call: { payeeId: payeeIdOf("landlord"), to: NET, token: NET, amount: 1n },
};

describe("agents network helpers", () => {
  it("permission bits match AgentRegistry", () => {
    expect(PERM).toEqual({ PAY: 1, MEMORY: 2, MESSAGE: 4, DEAL: 8 });
    expect(permMask(["PAY", "DEAL"])).toBe(9);
    expect(permNames(15)).toEqual(["PAY", "MEMORY", "MESSAGE", "DEAL"]);
    expect(permNames(4)).toEqual(["MESSAGE"]);
  });

  it("deal payee ids and codes", () => {
    expect(dealPayeeId(3n)).toBe(`0x${"0".repeat(63)}3`);
    expect(codeText(toHex(toBytes("HUMAN_UNBOUND"), { size: 32 }))).toBe("HUMAN_UNBOUND");
    expect(AGENT_CODES.HUMAN_UNBOUND).toMatch(/QIE ID/);
  });

  it("signs and recovers an agent-to-agent message", async () => {
    const key = privateKeyToAccount(keccak256(toBytes("agent-key")));
    const m = { fromAgent: 1n, toAgent: 2n, bodyHash: messageBodyHash("quote: 3 QUSDC"), nonce: 7n, deadline: 2_000_000_000n };
    const sig = await signAgentMessage(key, 1990, NET, m);
    expect(await agentMessageSigner(1990, NET, m, sig)).toBe(key.address);
    expect(await agentMessageSigner(1983, NET, m, sig)).not.toBe(key.address); // bound to the chain
    expect(await agentMessageSigner(1990, NET, { ...m, nonce: 8n }, sig)).not.toBe(key.address);
  });
});

describe("policy R4a: agent registry check", () => {
  it("passes through blocks and proposals without an agent", () => {
    const blocked: Verdict = { decision: "BLOCK", code: "OVER_CAP", reasons: ["x"] };
    expect(checkAgent(blocked, { agentId: 1n, verified: false, ok: false, code: "X" })).toBe(blocked);
    expect(checkAgent(allow, undefined)).toBe(allow);
  });

  it("fails closed on an unverified read and blocks with the registry's code", () => {
    expect(checkAgent(allow, { agentId: 1n, verified: false, ok: true, code: "" })).toMatchObject({ decision: "BLOCK", code: "LEDGER_UNVERIFIED" });
    const v = checkAgent(allow, { agentId: 2n, verified: true, ok: false, code: "HUMAN_UNBOUND" });
    expect(v).toMatchObject({ decision: "BLOCK", code: "AGENT_BLOCKED", payeeId: allow.payeeId });
    expect(v.reasons[0]).toBe("agent 2: HUMAN_UNBOUND");
    expect(checkAgent(allow, { agentId: 2n, verified: true, ok: true, code: "" })).toBe(allow);
  });
});
