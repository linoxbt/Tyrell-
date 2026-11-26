import { describe, expect, it } from "vitest";
import { keccak256, toBytes, type Hex } from "viem";
import {
  Blob,
  canonicalJson,
  computeProjection,
  digestDocument,
  firstDifference,
  Header,
  KeyHistory,
  normaliseParents,
  parentsHashOf,
  projectionDigest,
  SeedType,
  uuidv7,
  verifyMemory,
  isId16,
  type PayeeRecord,
  type Seed,
} from "../src/index.js";
import { accounts, ACCT, ctx, id, laneEvents, make } from "./fixture.js";

describe("canonical JSON (RFC 8785)", () => {
  it("sorts keys and is stable", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
  });
  it("throws for values JSON cannot hold", () => {
    expect(() => canonicalJson(undefined)).toThrow();
  });
});

describe("ids", () => {
  it("uuidv7 has version 7, variant 10 and sorts by time", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isId16(a)).toBe(true);
    expect(a[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(a[18]);
    expect(a < b).toBe(true);
    expect(isId16(uuidv7())).toBe(true);
  });
  it("rejects bad input", () => {
    expect(() => uuidv7(-1)).toThrow();
    expect(() => uuidv7(2 ** 48)).toThrow();
    expect(() => uuidv7(1, new Uint8Array(3))).toThrow();
  });
});

describe("envelope schema", () => {
  it("accepts a fixture header and rejects broken ones", async () => {
    const m = await make({ lane: 2, parents: [id(1), id(2)] });
    expect(Header.safeParse(m.header).success).toBe(true);
    expect(Blob.safeParse(m.blob).success).toBe(true);
    const bad = [
      { ...m.header, parents: [id(2), id(1)] },
      { ...m.header, parents: [id(1), id(1)] },
      { ...m.header, parents: [m.header.id] },
      { ...m.header, id: id(0) },
      { ...m.header, ns: "other" },
      { ...m.header, src: [{ t: "erc20", addr: "0x12" }] },
      { ...m.header, src: [{ t: "erc20", addr: accounts.user.address, extra: 1 }] },
      { ...m.header, bodyLen: 8193 },
      { ...m.header, id: m.header.id.toUpperCase() },
    ];
    for (const h of bad) expect(Header.safeParse(h).success).toBe(false);
  });

  it("normaliseParents sorts, lower-cases and de-duplicates; the empty parents hash is keccak of no bytes", () => {
    expect(normaliseParents([id(2), id(1), id(2)])).toEqual([id(1), id(2)]);
    expect(normaliseParents([id(10).toUpperCase().replace("0X", "0x") as Hex])).toEqual([id(10)]);
    expect(parentsHashOf([])).toBe(keccak256("0x"));
  });
});

describe("KeyHistory", () => {
  const k = accounts.agent.address;
  it("binds by position, block then log index", () => {
    const h = new KeyHistory([
      { kind: "added", lane: 2, key: k, pos: { block: 10n, logIndex: 5 } },
      { kind: "revoked", lane: 2, key: k, pos: { block: 20n, logIndex: 1 } },
    ]);
    expect(h.laneAt(k, { block: 10n, logIndex: 4 })).toBeUndefined();
    expect(h.laneAt(k, { block: 10n, logIndex: 6 })).toBe(2);
    expect(h.laneAt(k, { block: 20n, logIndex: 0 })).toBe(2);
    expect(h.laneAt(k, { block: 20n, logIndex: 1 })).toBeUndefined();
    expect(h.laneAt(accounts.user.address, { block: 15n, logIndex: 0 })).toBeUndefined();
    expect(h.activeKeys().size).toBe(0);
  });
  it("startup refuses unless every lane has exactly one active key", () => {
    expect(() => new KeyHistory(laneEvents).assertOneActiveKeyPerLane()).not.toThrow();
    expect(() => new KeyHistory(laneEvents.slice(0, 3)).assertOneActiveKeyPerLane()).toThrow(/lane 4/);
  });
  it("rejects histories LaneRegistry cannot produce", () => {
    const add = { kind: "added" as const, lane: 2, key: k, pos: { block: 1n, logIndex: 0 } };
    const rev = { kind: "revoked" as const, lane: 2, key: k, pos: { block: 2n, logIndex: 0 } };
    expect(() => new KeyHistory([add, { ...add, pos: { block: 3n, logIndex: 0 } }])).toThrow(/added twice/);
    expect(() => new KeyHistory([rev])).toThrow(/unknown/);
    expect(() => new KeyHistory([add, rev, { ...rev, pos: { block: 4n, logIndex: 0 } }])).toThrow(/already revoked/);
  });
});

describe("projection digest (I-10)", () => {
  const payees: PayeeRecord[] = [
    { payeeId: keccak256(toBytes("b")), addr: accounts.user.address, token: accounts.agent.address, capPerTx: 5n, capPerDay: 5n, label: "b", active: true, suspended: false },
    { payeeId: keccak256(toBytes("a")), addr: accounts.wallet.address, token: accounts.agent.address, capPerTx: 2n ** 100n, capPerDay: 2n ** 100n, label: "a", active: true, suspended: true },
  ];
  const seeds: Seed[] = [
    { seedId: 2, type: SeedType.Memory, value: keccak256(toBytes("x")), fromBlock: 0n, toBlock: 0n, released: true },
    { seedId: 1, type: SeedType.Source, value: keccak256(toBytes("y")), fromBlock: 0n, toBlock: 0n, released: false },
  ];

  it("is independent of input order and changes when anything that matters changes", async () => {
    const a = await make({ lane: 1 });
    const b = await make({ lane: 3 });
    const ra = await verifyMemory(a.id, a.anchor, { ok: true, blob: a.blob }, ctx());
    const rb = await verifyMemory(b.id, b.anchor, { ok: true, blob: b.blob }, ctx());
    const p1 = computeProjection([ra, rb], seeds);
    const p2 = computeProjection([rb, ra], [...seeds].reverse());
    const base = { acct: ACCT, head: 123n, payees, seeds };
    const d1 = projectionDigest({ ...base, projection: p1 });
    expect(projectionDigest({ ...base, projection: p2, payees: [...payees].reverse(), seeds: [...seeds].reverse() })).toBe(d1);
    expect(projectionDigest({ ...base, head: 124n, projection: p1 })).not.toBe(d1);

    const quarantined = computeProjection([ra, rb], [{ seedId: 3, type: SeedType.Memory, value: `${b.id}${"00".repeat(16)}` as Hex, fromBlock: 0n, toBlock: 0n, released: false }]);
    const doc1 = digestDocument({ ...base, projection: p1 });
    const doc2 = digestDocument({ ...base, projection: quarantined });
    expect(firstDifference(doc1, doc2)).toMatch(/^memories\[\d\]/);
    expect(firstDifference(doc1, doc1)).toBeUndefined();
    expect(firstDifference(doc1, { ...doc1, head: "1" })).toBe("head: 123 != 1");
    expect(firstDifference(doc1, { ...doc1, seeds: doc1.seeds.slice(1) })).toMatch(/^seeds\[0\]/);
    expect(doc1.payees[0]?.capPerTx).toBe((2n ** 100n).toString());
  });

  it("records memories without a body hash as null", () => {
    const p = computeProjection([{ status: "unverified", id: id(5), reason: "NO_ANCHOR" }], []);
    expect(digestDocument({ acct: ACCT, head: 1n, projection: p, payees: [], seeds: [] }).memories).toEqual([
      { id: id(5), lane: 0, cls: "unverified", q: false, bodyHash: null },
    ]);
  });
});
