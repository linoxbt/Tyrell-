import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import {
  BlobUnavailable,
  cidOf,
  DecryptError,
  decryptKeystore,
  DirBlobStore,
  encryptKeystore,
  importDataKey,
  keystoreAddress,
  KeystoreError,
  loadKey,
  MemoryBlobStore,
  migrateKeystore,
  readCapped,
  newSecret,
  openBlob,
  PinataBlobStore,
  ProjectionDb,
  readKeystore,
  sealBlob,
  writeKeystore,
} from "../src/index.js";

const PW = "correct horse battery";
const FAST = 2 ** 10; // low scrypt cost for tests only
const tmp = () => mkdtempSync(join(tmpdir(), "tyrell-storage-"));
const ACCT = keccak256(toBytes("acct"));
const ID: Hex = "0x0193a1b2c3d47e8f9a0b1c2d3e4f5a6b";

describe("keystore v3", () => {
  it("round-trips an EVM key and records its address and role", () => {
    const secret = newSecret();
    const ks = encryptKeystore(secret, PW, { role: "agent", evm: true, n: FAST });
    expect(`0x${ks.address}`).toBe(privateKeyToAddress(`0x${Buffer.from(secret).toString("hex")}`).toLowerCase());
    expect(ks.tyrell?.role).toBe("agent");
    expect(decryptKeystore(ks, PW)).toEqual(secret);
  });

  it("the data key has no address", () => {
    const ks = encryptKeystore(newSecret(), PW, { role: "data", evm: false, n: FAST });
    expect(ks.address).toBeUndefined();
  });

  it("wrong passphrase, tampering and bad input fail without leaking the key", () => {
    const secret = newSecret();
    const ks = encryptKeystore(secret, PW, { role: "user", evm: true, n: FAST });
    expect(() => decryptKeystore(ks, "wrong passphrase")).toThrow(KeystoreError);
    const flipped = { ...ks, crypto: { ...ks.crypto, ciphertext: ks.crypto.ciphertext.replace(/^./, (c) => (c === "0" ? "1" : "0")) } };
    expect(() => decryptKeystore(flipped, PW)).toThrow(/wrong passphrase or corrupted/);
    try {
      decryptKeystore(ks, "wrong passphrase");
    } catch (e) {
      expect(String(e)).not.toContain(Buffer.from(secret).toString("hex"));
    }
    expect(() => encryptKeystore(new Uint8Array(31), PW, { role: "x", evm: true })).toThrow(/32 bytes/);
    expect(() => encryptKeystore(secret, "short", { role: "x", evm: true })).toThrow(/8 characters/);
    expect(() => decryptKeystore({ ...ks, version: 2 as 3 }, PW)).toThrow(/unsupported/);
  });

  it("detects an address that does not match the key", () => {
    const ks = encryptKeystore(newSecret(), PW, { role: "user", evm: true, n: FAST });
    expect(() => decryptKeystore({ ...ks, address: "00".repeat(20) }, PW)).toThrow(/does not match/);
  });

  it("writes 0600 files, never overwrites, and refuses another role's file (I-12)", () => {
    const dir = tmp();
    const path = join(dir, "keys", "agent.json");
    const ks = encryptKeystore(newSecret(), PW, { role: "agent", evm: true, n: FAST });
    writeKeystore(path, ks);
    expect(() => writeKeystore(path, ks)).toThrow(/refusing to overwrite/);
    expect(keystoreAddress(path).toLowerCase()).toBe(`0x${ks.address}`);
    expect(readKeystore(path).tyrell?.role).toBe("agent");
    expect(loadKey(path, PW, "agent")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => loadKey(path, PW, "user")).toThrow(/holds the agent key, not user/);
    const dataPath = join(dir, "keys", "data.json");
    writeKeystore(dataPath, encryptKeystore(newSecret(), PW, { role: "data", evm: false, n: FAST }));
    expect(() => keystoreAddress(dataPath)).toThrow(/not an EVM key/);
  });

  it("binds the role tag with a second MAC: a relabelled file is refused, a legacy file needs migrating (I-12)", () => {
    const dir = tmp();
    const ks = encryptKeystore(newSecret(), PW, { role: "agent", evm: true, n: FAST });
    expect(ks.tyrell?.mac).toMatch(/^[0-9a-f]{64}$/);
    const relabelled = join(dir, "control.json");
    writeKeystore(relabelled, { ...ks, tyrell: { role: "control", mac: ks.tyrell!.mac! } });
    expect(() => loadKey(relabelled, PW, "control")).toThrow(/role tag of this keystore was changed/);
    // the standard v3 MAC is untouched, so other tools still read the file
    expect(decryptKeystore({ ...ks, tyrell: { role: "control" } }, PW)).toHaveLength(32);
    const legacy = join(dir, "agent.json");
    writeKeystore(legacy, { ...ks, tyrell: { role: "agent" } });
    expect(() => loadKey(legacy, PW, "agent")).toThrow(/tyrell keys migrate/);
    const migrated = migrateKeystore(readKeystore(legacy), PW, "agent");
    expect(migrated.tyrell?.mac).toBe(ks.tyrell!.mac);
    expect(() => migrateKeystore(readKeystore(legacy), "wrong passphrase", "agent")).toThrow(KeystoreError);
    expect(() => migrateKeystore(readKeystore(legacy), PW, "user")).toThrow(/not user/);
  });

  it("refuses scrypt parameters a hostile file could use to exhaust memory", () => {
    const ks = encryptKeystore(newSecret(), PW, { role: "user", evm: true, n: FAST });
    const withN = (n: number, r = 8, p = 1) => ({ ...ks, crypto: { ...ks.crypto, kdfparams: { ...ks.crypto.kdfparams, n, r, p } } });
    expect(() => decryptKeystore(withN(2 ** 30), PW)).toThrow(/too costly/);
    expect(() => decryptKeystore(withN(2 ** 14, 64), PW)).toThrow(/too costly/);
    expect(() => decryptKeystore(withN(2 ** 14, 8, 99), PW)).toThrow(/too costly/);
    expect(() => decryptKeystore(withN(1000), PW)).toThrow(/invalid scrypt/);
    expect(() => decryptKeystore(withN(-2), PW)).toThrow(/invalid scrypt/);
  });

  it("Foundry's cast reads Tyrell keystores", () => {
    const cast = join(__dirname, "../../../contracts/node_modules/.bin/cast");
    if (!existsSync(cast)) return;
    const dir = tmp();
    const path = join(dir, "submitter.json");
    const ks = encryptKeystore(newSecret(), PW, { role: "submitter", evm: true, n: FAST });
    writeKeystore(path, ks);
    const pwFile = join(dir, "pw");
    writeFileSync(pwFile, PW);
    const out = execFileSync(cast, ["wallet", "address", "--keystore", path, "--password-file", pwFile], { encoding: "utf8" }).trim();
    expect(out.toLowerCase()).toBe(`0x${ks.address}`);
  });
});

describe("AES-256-GCM sealing", () => {
  it("round-trips and binds the account and memory id", async () => {
    const key = await importDataKey(newSecret());
    const blob = { header: { id: ID }, body: "pay rent", signature: "0x" };
    const sealed = await sealBlob(key, ACCT, ID, blob);
    expect(new TextDecoder().decode(sealed)).not.toContain("pay rent");
    expect(await openBlob(key, ACCT, ID, sealed)).toEqual(blob);
    await expect(openBlob(key, ACCT, "0x0193a1b2c3d47e8f9a0b1c2d3e4f5a6c", sealed)).rejects.toThrow(DecryptError);
    await expect(openBlob(await importDataKey(newSecret()), ACCT, ID, sealed)).rejects.toThrow(DecryptError);
    const tampered = new Uint8Array(sealed);
    tampered[20]! ^= 1;
    await expect(openBlob(key, ACCT, ID, tampered)).rejects.toThrow(DecryptError);
    await expect(openBlob(key, ACCT, ID, new Uint8Array(10))).rejects.toThrow(/too short/);
  });

  it("two seals of the same blob differ (random nonce)", async () => {
    const key = await importDataKey(newSecret());
    const a = await sealBlob(key, ACCT, ID, { x: 1 });
    const b = await sealBlob(key, ACCT, ID, { x: 1 });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("rejects non-JSON plaintext and wrong key sizes", async () => {
    const raw = newSecret();
    const key = await importDataKey(raw);
    const { webcrypto } = await import("node:crypto");
    const iv = new Uint8Array(12);
    const aad = new Uint8Array([...Buffer.from(ACCT.slice(2), "hex"), ...Buffer.from(ID.slice(2), "hex")]);
    const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, toBytes("not json")));
    await expect(openBlob(key, ACCT, ID, new Uint8Array([...iv, ...ct]))).rejects.toThrow(/not JSON/);
    await expect(importDataKey(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
  });
});

describe("blob stores", () => {
  it("reads gateway bodies with a hard size cap, without buffering past it", async () => {
    expect(await readCapped(new Response(new Uint8Array(10)), 16)).toHaveLength(10);
    expect(await readCapped(new Response(new Uint8Array(17)), 16)).toBeUndefined();
    expect(await readCapped(new Response("x", { headers: { "content-length": "999999" } }), 16)).toBeUndefined();
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1024));
      },
    });
    expect(await readCapped(new Response(endless), 4096)).toBeUndefined();
    expect(pulled).toBeLessThan(10);
  });

  it("cidOf matches IPFS for the empty raw block", () => {
    expect(cidOf(new Uint8Array())).toBe("bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku");
  });

  it("memory and dir stores round-trip; the dir store catches swapped content", async () => {
    const bytes = toBytes("sealed");
    const mem = new MemoryBlobStore();
    const cid = await mem.put(bytes);
    expect(await mem.get(cid)).toEqual(bytes);
    await expect(mem.get("bafkreinope")).rejects.toThrow(BlobUnavailable);

    const dir = tmp();
    const store = new DirBlobStore(dir);
    const c2 = await store.put(bytes);
    expect(c2).toBe(cid);
    expect(await store.put(bytes)).toBe(cid);
    expect(await store.get(cid)).toEqual(bytes);
    writeFileSync(join(dir, cid), "evil");
    await expect(store.get(cid)).rejects.toThrow(/does not match/);
    await expect(store.get("../etc")).rejects.toThrow(/invalid/);
    await expect(store.get("bafkreimissing")).rejects.toThrow(/not found/);
  });

  it("Pinata: uploads with the JWT, reads through gateways in order, rejects bad content", async () => {
    const bytes = toBytes("sealed");
    const cid = cidOf(bytes);
    const calls: string[] = [];
    const fake: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://uploads.pinata.cloud")) {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
        return new Response(JSON.stringify({ data: { cid } }), { status: 200 });
      }
      if (url.startsWith("https://gw.example")) return new Response("down", { status: 502 });
      if (url.startsWith("https://liar.example")) return new Response("evil", { status: 200 });
      if (url.startsWith("https://huge.example")) return new Response(new Uint8Array(70_000), { status: 200 });
      if (url.startsWith("https://throws.example")) throw new Error("ECONNRESET");
      return new Response(bytes, { status: 200 });
    };
    const store = new PinataBlobStore({
      jwt: "jwt",
      gateway: "https://gw.example/",
      fallbackGateways: ["https://liar.example", "https://huge.example", "https://throws.example", "https://good.example"],
      fetch: fake,
    });
    expect(await store.put(bytes)).toBe(cid);
    expect(await store.get(cid)).toEqual(bytes);
    expect(calls.slice(1).map((u) => new URL(u).host)).toEqual(["gw.example", "liar.example", "huge.example", "throws.example", "good.example"]);
    await expect(store.get("bad/cid")).rejects.toThrow(/invalid/);

    const allBad = new PinataBlobStore({ jwt: "jwt", fallbackGateways: ["https://gw.example"], fetch: fake });
    await expect(allBad.get(cid)).rejects.toThrow(/gw.example: HTTP 502/);

    const failing: typeof fetch = async () => new Response("{}", { status: 401 });
    await expect(new PinataBlobStore({ jwt: "x", fetch: failing }).put(bytes)).rejects.toThrow(/HTTP 401/);
  });
});

describe("ProjectionDb", () => {
  const row = (id: string, block: number) => ({
    id,
    lane: 2,
    signer: "0xabc",
    ns: "0x1",
    structHash: "0x2",
    parentsHash: "0x3",
    bodyHash: "0x4",
    cid: "bafy",
    refBlock: "1",
    block: String(block),
    logIndex: 0,
  });

  it("stores anchors in chain order and blobs by id", () => {
    const db = new ProjectionDb(":memory:");
    db.putAnchor(row("b", 20));
    db.putAnchor(row("a", 3));
    db.putAnchor(row("a", 3));
    expect(db.anchors().map((a) => a.id)).toEqual(["a", "b"]);
    db.putBlob("a", { body: "x" });
    expect(db.blob("a")).toEqual({ body: "x" });
    expect(db.blob("zz")).toBeUndefined();
    db.setMeta("head", "5");
    db.setMeta("head", "6");
    expect(db.getMeta("head")).toBe("6");
    expect(db.getMeta("nope")).toBeUndefined();
    db.close();
  });

  it("recall searches only the visible set, and FTS syntax in queries is inert", () => {
    const dir = tmp();
    const db = new ProjectionDb(join(dir, "p.sqlite"));
    db.setVisible([
      { id: "u1", cls: "trusted", body: "pay rent to landlord, 5 QUSDC, on the 1st" },
      { id: "w1", cls: "untrusted", body: "token name: USDC Rewards" },
    ]);
    expect(db.search("rent").map((r) => r.id)).toEqual(["u1"]);
    expect(db.search("rent OR NEAR(* ) \"")).toHaveLength(1);
    expect(db.search("!!!")).toEqual([]);
    expect(db.isVisible("w1")).toBe(true);
    db.setVisible([{ id: "u1", cls: "trusted", body: "pay rent to landlord" }]); // w1 quarantined
    expect(db.isVisible("w1")).toBe(false);
    expect(db.search("USDC")).toEqual([]);
    db.close();
  });

  it("setVisible is atomic", () => {
    const db = new ProjectionDb(":memory:");
    db.setVisible([{ id: "a", cls: "trusted", body: "one" }]);
    expect(() => db.setVisible([{ id: "b", cls: "trusted", body: "two" }, { id: "b", cls: "trusted", body: "dup" }])).toThrow();
    expect(db.search("one").map((r) => r.id)).toEqual(["a"]);
  });
});
