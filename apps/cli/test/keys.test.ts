import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { account, checkKeyIsolation, passphrase, passphraseFile } from "../src/config.js";
import { setupKeys } from "../src/setup.js";

/*
 * S-3, key separation: one passphrase per role on public networks, private (0600) key and passphrase
 * files, and a process that could open another role's key refuses to start outside a local chain.
 */

const saved = { ...process.env };
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "tyrell-keys-"));
  process.env.TYRELL_HOME = home;
  delete process.env.KEYSTORE_PASSPHRASE_FILE;
  delete process.env.TYRELL_STRICT_KEYS;
  delete process.env.TYRELL_INSECURE_SHARED_KEYS;
});
afterEach(() => {
  process.env = { ...saved };
});

const FAST = 2 ** 10;

describe("key separation (S-3)", () => {
  it("testnet: --new-passphrase writes one private passphrase per role, and the shared file is refused", () => {
    const r = setupKeys({ network: "testnet", newPassphrase: true, scryptN: 2 ** 14 }, passphrase);
    expect(r.created).toHaveLength(7);
    for (const role of ["user", "agent", "control", "data"]) expect(passphraseFile(role)).toEqual({ file: join(home, "pass.d", role), shared: false });
    expect(passphrase("agent")).not.toBe(passphrase("control"));
    // every process can read every file in this single-user test, so each refuses to start
    expect(() => checkKeyIsolation("steward")).toThrow(/steward can open keys that are not its own/);
    process.env.TYRELL_INSECURE_SHARED_KEYS = "1";
    expect(checkKeyIsolation("steward").length).toBeGreaterThan(0);
    expect(account("steward", "agent").address).toBe(r.addresses.agent);
  });

  it("testnet: a shared passphrase is refused at setup, and the scrypt floor holds", () => {
    writeFileSync(join(home, "pass"), "correct horse battery\n", { mode: 0o600 });
    expect(() => setupKeys({ network: "testnet", scryptN: 2 ** 14 }, passphrase)).toThrow(/each role needs its own passphrase/);
    expect(() => setupKeys({ network: "mainnet", scryptN: FAST }, passphrase)).toThrow(/below the minimum/);
  });

  it("local: the shared passphrase works with a warning, and files open to other users are refused", () => {
    const r = setupKeys({ network: "local", newPassphrase: true, scryptN: FAST }, passphrase);
    expect(passphraseFile("agent").shared).toBe(true);
    expect(checkKeyIsolation("steward").length).toBe(6);
    process.env.TYRELL_STRICT_KEYS = "1";
    expect(() => checkKeyIsolation("steward")).toThrow(/can open keys/);
    delete process.env.TYRELL_STRICT_KEYS;
    expect(account("steward", "agent").address).toBe(r.addresses.agent);
    chmodSync(join(home, "pass"), 0o644);
    expect(() => passphrase("agent")).toThrow(/accessible to other users/);
    chmodSync(join(home, "pass"), 0o600);
    chmodSync(join(home, "keys", "agent.json"), 0o640);
    expect(() => account("steward", "agent")).toThrow(/key file .* is accessible to other users/);
  });
});
