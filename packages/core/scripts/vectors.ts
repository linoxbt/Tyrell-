/**
 * Writes contracts/test/vectors/core.json: EIP-712 struct hashes, a digest and a real signature
 * computed by @tyrell/core. contracts/test/Vectors.t.sol checks the Solidity side produces the same
 * values, so TypeScript and the contracts cannot drift apart unnoticed.
 *
 *   pnpm --filter @tyrell/core vectors
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildVectors } from "../test/vectors.js";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts/test/vectors/core.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(await buildVectors(), null, 2) + "\n");
console.log(`wrote ${out}`);
