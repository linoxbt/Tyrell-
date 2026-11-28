import { privateKeyToAddress } from "viem/accounts";
import { bytesToHex } from "viem";
import { describe, expect, it } from "vitest";
import { decryptKeystore } from "../../../packages/storage/src/keystore";
import { createKey } from "../lib/keystore";

describe("keys created in the browser", () => {
  it("are keystore v3 files the Tyrell processes can read, tagged with their role", async () => {
    const { address, keystore } = await createKey("agent", "correct horse battery", 2 ** 10);
    expect(keystore.tyrell.role).toBe("agent");
    expect(keystore.address).toBe(address!.slice(2).toLowerCase());
    const secret = decryptKeystore(keystore as never, "correct horse battery", "agent");
    // the role MAC binds the tag: relabelled as another role, the file is refused
    expect(() => decryptKeystore({ ...keystore, tyrell: { ...keystore.tyrell, role: "control" } } as never, "correct horse battery", "control")).toThrow(/role tag/);
    expect(privateKeyToAddress(bytesToHex(secret))).toBe(address);
    expect(() => decryptKeystore(keystore as never, "wrong password!")).toThrow();
  });

  it("make a data key without an address, and refuse short passwords", async () => {
    const { address, keystore } = await createKey("data", "correct horse battery", 2 ** 10);
    expect(address).toBeUndefined();
    expect(keystore.address).toBeUndefined();
    expect(decryptKeystore(keystore as never, "correct horse battery", "data")).toHaveLength(32);
    await expect(createKey("user", "short")).rejects.toThrow("at least 8");
  });
});
