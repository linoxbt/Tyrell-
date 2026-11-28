import { describe, expect, it } from "vitest";
import { getAddress, keccak256, toBytes, toHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AGENT_CODES,
  agentKeyRotationSigner,
  agentRegistrationSigner,
  agentRegistryDomain,
  signAgentKeyRotation,
  signAgentRegistration,
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

describe("agent registration consent (S-1)", () => {
  const key = privateKeyToAccount(keccak256(toBytes("tyrell agents.test registration key")));
  const human = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
  const registry = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;

  it("the agent key's signature recovers to the agent key", async () => {
    const sig = await signAgentRegistration(key, 1983, registry, human, 1_900_000_000n);
    expect(await agentRegistrationSigner(1983, registry, human, key.address, 1_900_000_000n, sig)).toBe(key.address);
  });

  it("is bound to the human, the chain, the registry and the deadline", async () => {
    const sig = await signAgentRegistration(key, 1983, registry, human, 1_900_000_000n);
    const other = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
    for (const [c, r, h, d] of [
      [1990, registry, human, 1_900_000_000n],
      [1983, other, human, 1_900_000_000n],
      [1983, registry, other, 1_900_000_000n],
      [1983, registry, human, 1_900_000_001n],
    ] as const) {
      expect(await agentRegistrationSigner(c, r, h, key.address, d, sig)).not.toBe(key.address);
    }
    expect(agentRegistryDomain(1983, registry)).toEqual({ name: "TyrellAgentRegistry", version: "1", chainId: 1983, verifyingContract: registry });
  });
});

describe("agent key rotation consent", () => {
  const next = privateKeyToAccount(keccak256(toBytes("tyrell agents.test rotation key")));
  const human = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
  const registry = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;

  it("recovers to the new key, and is bound to the agent id", async () => {
    const sig = await signAgentKeyRotation(next, 1983, registry, 7n, human, 1_900_000_000n);
    expect(await agentKeyRotationSigner(1983, registry, 7n, human, next.address, 1_900_000_000n, sig)).toBe(next.address);
    expect(await agentKeyRotationSigner(1983, registry, 8n, human, next.address, 1_900_000_000n, sig)).not.toBe(next.address);
    // a registration consent is a different type: it doesn't verify as a rotation
    const reg = await signAgentRegistration(next, 1983, registry, human, 1_900_000_000n);
    expect(await agentKeyRotationSigner(1983, registry, 7n, human, next.address, 1_900_000_000n, reg)).not.toBe(next.address);
  });
});
