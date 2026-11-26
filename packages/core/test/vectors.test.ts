import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEDGER_SIGNER_LANE, LEDGER_TYPES } from "../src/index.js";
import { buildVectors } from "./vectors.js";

describe("cross-language vectors", () => {
  it("contracts/test/vectors/core.json is current (run `pnpm --filter ./packages/core vectors` if not)", async () => {
    const onDisk = JSON.parse(readFileSync(new URL("../../../contracts/test/vectors/core.json", import.meta.url), "utf8"));
    expect(JSON.parse(JSON.stringify(await buildVectors()))).toEqual(onDisk);
  });

  it("every ledger action names its signing lane", () => {
    expect(Object.keys(LEDGER_SIGNER_LANE).sort()).toEqual(Object.keys(LEDGER_TYPES).sort());
    expect(LEDGER_SIGNER_LANE.AddPayee).toBe("user");
    expect(LEDGER_SIGNER_LANE.ReleaseQuarantine).toBe("user");
    expect(LEDGER_SIGNER_LANE.SeedQuarantine).toBe("control");
  });
});
