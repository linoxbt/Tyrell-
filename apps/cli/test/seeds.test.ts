import { describe, expect, it } from "vitest";
import { getAddress, keccak256, toBytes } from "viem";
import { addressSeedValue, id16SeedValue, SeedType, sourceSeedValue } from "@tyrell/core";
import { encodeSeed } from "@tyrell/control";
import { mermaid, parseSeed } from "../src/response.js";

const A = getAddress(keccak256(toBytes("a")).slice(0, 42));
const ID = "0x0193a1b2c3d47e8f9a0b1c2d3e4f5a6b";

describe("quarantine seeds: CLI parsing and on-chain encoding (all four types)", () => {
  it("parses exactly one seed flag", () => {
    expect(parseSeed({ source: A })).toEqual({ type: "source", ref: A });
    expect(parseSeed({ memory: ID.toUpperCase().replace("0X", "0x") })).toEqual({ type: "memory", id: ID });
    expect(parseSeed({ turn: ID })).toEqual({ type: "turn", turn: ID });
    expect(parseSeed({ signerWindow: `${A}:100-200` })).toEqual({ type: "signer-window", signer: A, fromBlock: "100", toBlock: "200" });
    expect(() => parseSeed({})).toThrow(/exactly one/);
    expect(() => parseSeed({ source: A, turn: ID })).toThrow(/exactly one/);
    expect(() => parseSeed({ signerWindow: "nope" })).toThrow(/address/);
  });

  it("encodes each type the way TyrellLedger stores it", () => {
    expect(encodeSeed({ type: "source", ref: A })).toEqual({ seedType: SeedType.Source, seedValue: sourceSeedValue(A), fromBlock: 0n, toBlock: 0n });
    expect(encodeSeed({ type: "memory", id: ID })).toEqual({ seedType: SeedType.Memory, seedValue: id16SeedValue(ID), fromBlock: 0n, toBlock: 0n });
    expect(encodeSeed({ type: "turn", turn: ID })).toEqual({ seedType: SeedType.Turn, seedValue: id16SeedValue(ID), fromBlock: 0n, toBlock: 0n });
    expect(encodeSeed({ type: "signer-window", signer: A, fromBlock: 5n, toBlock: 9n })).toEqual({ seedType: SeedType.SignerWindow, seedValue: addressSeedValue(A), fromBlock: 5n, toBlock: 9n });
  });

  it("renders a blast radius as Mermaid", () => {
    const m = mermaid({
      seedId: 1,
      memories: [ID],
      decisions: [],
      vaultTxs: [],
      nodes: [
        { id: "src:0x1", type: "source", label: `erc20 ${A}` },
        { id: ID, type: "memory", label: 'name "SYSTEM NOTE"', lane: 3, cls: "untrusted", quarantined: true },
      ],
      edges: [{ from: "src:0x1", to: ID }],
    });
    expect(m.split("\n")[0]).toBe("graph LR");
    expect(m).toContain("lane 3 untrusted Q");
    expect(m).not.toMatch(/"SYSTEM/); // quotes in labels are escaped
  });
});
