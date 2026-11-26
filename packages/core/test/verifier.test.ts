import { describe, expect, it } from "vitest";
import { keccak256, toBytes, type Hex } from "viem";
import { verifyMemory, type BlobFetch } from "../src/index.js";
import { accounts, ctx, laneEvents, make } from "./fixture.js";

const ok = (blob: unknown): BlobFetch => ({ ok: true, blob });

describe("verifyMemory (spec section 6 order)", () => {
  it("verifies a correctly signed and anchored memory", async () => {
    const m = await make({ lane: 2 });
    const r = await verifyMemory(m.id, m.anchor, ok(m.blob), ctx());
    expect(r.status).toBe("verified");
    if (r.status === "verified") {
      expect(r.signer).toBe(accounts.agent.address);
      expect(r.body).toBe(m.body);
    }
  });

  it("1. NO_ANCHOR", async () => {
    const m = await make({ lane: 2 });
    expect(await verifyMemory(m.id, undefined, ok(m.blob), ctx())).toMatchObject({ status: "unverified", reason: "NO_ANCHOR" });
  });

  it("2. BODY_UNAVAILABLE and DECRYPT_FAILED keep the fetch's reason and detail", async () => {
    const m = await make({ lane: 2 });
    expect(await verifyMemory(m.id, m.anchor, { ok: false, reason: "BODY_UNAVAILABLE", detail: "all gateways 404" }, ctx())).toMatchObject({
      reason: "BODY_UNAVAILABLE",
      detail: "all gateways 404",
      anchor: m.anchor,
    });
    expect(await verifyMemory(m.id, m.anchor, { ok: false, reason: "DECRYPT_FAILED" }, ctx())).toMatchObject({ reason: "DECRYPT_FAILED" });
  });

  it("2. MALFORMED_ENVELOPE for anything that is not a valid blob", async () => {
    const m = await make({ lane: 2 });
    for (const bad of [null, {}, { ...m.blob, extra: 1 }, { ...m.blob, header: { ...m.header, v: 2 } }, { ...m.blob, signature: "0x12" }]) {
      const r = await verifyMemory(m.id, m.anchor, ok(bad), ctx());
      expect(r).toMatchObject({ status: "unverified", reason: "MALFORMED_ENVELOPE" });
      expect(r.status === "unverified" && r.header).toBeFalsy();
    }
  });

  it("2. ID_MISMATCH when the blob's id differs from the anchor or the requested id", async () => {
    const a = await make({ lane: 2 });
    const b = await make({ lane: 2 });
    expect(await verifyMemory(a.id, a.anchor, ok(b.blob), ctx())).toMatchObject({ reason: "ID_MISMATCH" });
    expect(await verifyMemory(b.id, a.anchor, ok(a.blob), ctx())).toMatchObject({ reason: "ID_MISMATCH" });
  });

  it("2. ACCOUNT_MISMATCH", async () => {
    const m = await make({ lane: 2 });
    const r = await verifyMemory(m.id, m.anchor, ok(m.blob), { ...ctx(), acct: keccak256(toBytes("someone else")) });
    expect(r).toMatchObject({ reason: "ACCOUNT_MISMATCH" });
    expect(r.status === "unverified" && r.header?.id).toBe(m.id);
  });

  it("3. T-05 BODY_HASH_MISMATCH when the body on IPFS was swapped", async () => {
    const m = await make({ lane: 3, body: "rent goes to the landlord" });
    const tampered = { ...m.blob, body: "rent goes to 0xBAD" };
    expect(await verifyMemory(m.id, m.anchor, ok(tampered), ctx())).toMatchObject({ reason: "BODY_HASH_MISMATCH" });
  });

  it("3. BODY_LEN_MISMATCH", async () => {
    const m = await make({ lane: 2, body: "abc", bodyLen: 4 });
    expect(await verifyMemory(m.id, m.anchor, ok(m.blob), ctx())).toMatchObject({ reason: "BODY_LEN_MISMATCH", detail: "header 4, body 3" });
  });

  it("3. PARENTS_HASH_MISMATCH, NAMESPACE_MISMATCH, HEADER_HASH_MISMATCH", async () => {
    const m = await make({ lane: 2 });
    const zero = `0x${"00".repeat(32)}` as Hex;
    expect(await verifyMemory(m.id, { ...m.anchor, parentsHash: zero }, ok(m.blob), ctx())).toMatchObject({ reason: "PARENTS_HASH_MISMATCH" });
    expect(await verifyMemory(m.id, { ...m.anchor, ns: zero }, ok(m.blob), ctx())).toMatchObject({ reason: "NAMESPACE_MISMATCH" });
    // src is only covered by the struct hash: change it in the blob
    const srcChanged = { ...m.blob, header: { ...m.header, src: [{ t: "user-msg" as const, id: "x" }] } };
    expect(await verifyMemory(m.id, m.anchor, ok(srcChanged), ctx())).toMatchObject({ reason: "HEADER_HASH_MISMATCH" });
  });

  it("4. BAD_SIGNATURE for a signature that cannot be recovered", async () => {
    const m = await make({ lane: 2 });
    const r = await verifyMemory(m.id, m.anchor, ok({ ...m.blob, signature: `0x${"00".repeat(65)}` }), ctx());
    expect(r).toMatchObject({ reason: "BAD_SIGNATURE" });
  });

  it("4. SIGNER_MISMATCH when the anchor names someone else", async () => {
    const m = await make({ lane: 2 });
    expect(await verifyMemory(m.id, { ...m.anchor, signer: accounts.user.address }, ok(m.blob), ctx())).toMatchObject({
      reason: "SIGNER_MISMATCH",
    });
  });

  it("5. UNBOUND_KEY for a key LaneRegistry never bound", async () => {
    const m = await make({ lane: 2, signer: accounts.stranger });
    expect(await verifyMemory(m.id, m.anchor, ok(m.blob), ctx())).toMatchObject({ reason: "UNBOUND_KEY" });
  });

  it("5. LANE_MISMATCH: the agent key claims the user lane (off-chain T-03)", async () => {
    const m = await make({ lane: 1, signer: accounts.agent });
    expect(await verifyMemory(m.id, m.anchor, ok(m.blob), ctx())).toMatchObject({
      reason: "LANE_MISMATCH",
      detail: "key is lane 2, envelope claims 1",
    });
  });

  it("5. historical binding: a revoked key's earlier memories still verify, later ones do not", async () => {
    const events = [...laneEvents, { kind: "revoked" as const, lane: 2, key: accounts.agent.address, pos: { block: 150n, logIndex: 3 } }];
    const before = await make({ lane: 2, block: 150n });
    before.anchor.pos.logIndex = 2;
    const after = await make({ lane: 2, block: 150n });
    after.anchor.pos.logIndex = 3;
    expect((await verifyMemory(before.id, before.anchor, ok(before.blob), ctx(events))).status).toBe("verified");
    expect(await verifyMemory(after.id, after.anchor, ok(after.blob), ctx(events))).toMatchObject({ reason: "UNBOUND_KEY" });
  });

  it("6. REFBLOCK_AFTER_ANCHOR", async () => {
    const m = await make({ lane: 2, refBlock: 500, block: 400n });
    expect(await verifyMemory(m.id, m.anchor, ok(m.blob), ctx())).toMatchObject({ reason: "REFBLOCK_AFTER_ANCHOR" });
  });

  it("accepts mixed-case hex in anchor records", async () => {
    const m = await make({ lane: 3 });
    const upper = { ...m.anchor, id: m.anchor.id.toUpperCase().replace("0X", "0x") as Hex, bodyHash: m.anchor.bodyHash.toUpperCase().replace("0X", "0x") as Hex };
    expect((await verifyMemory(m.id, upper, ok(m.blob), ctx())).status).toBe("verified");
  });
});
