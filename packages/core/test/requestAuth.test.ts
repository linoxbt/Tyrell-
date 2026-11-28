import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { recoverRequest, REQUEST_AUTH_TTL, signRequest } from "../src/index.js";

const key = privateKeyToAccount(keccak256(toBytes("request-auth-test")));
const acct = keccak256(toBytes("acct"));
const req = { type: "propose", proposal: { recipient: "0xabc", amount: "1", token: "0xdef" }, readSet: [], turn: "0x01", n: 5n };

describe("signed IPC requests (S-6)", () => {
  it("recovers the signer of an untouched request", async () => {
    const signed = await signRequest(key, acct, req);
    expect(await recoverRequest(acct, signed)).toBe(key.address);
  });

  it("refuses a changed request, another account, an expired or unsigned one, and a spoofed sender", async () => {
    const signed = await signRequest(key, acct, req);
    await expect(recoverRequest(acct, { ...signed, readSet: ["0x02"] })).rejects.toThrow(/does not match its sender/);
    await expect(recoverRequest(keccak256(toBytes("other")), signed)).rejects.toThrow(/does not match/);
    const later = Date.now() + (REQUEST_AUTH_TTL + 5) * 1000;
    await expect(recoverRequest(acct, signed, later)).rejects.toThrow(/expired/);
    await expect(recoverRequest(acct, { ...req })).rejects.toThrow(/unsigned/);
    await expect(recoverRequest(acct, { ...signed, auth: { ...signed.auth, expires: signed.auth.expires + 3600 } })).rejects.toThrow(/too far ahead/);
  });
});
