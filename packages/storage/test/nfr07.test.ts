import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");
const SOURCES = ["packages", "apps", "scripts"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name === "dist" || name === "test") return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|mjs|js)$/.test(name) ? [p] : [];
  });
}

/** NFR-07 / I-7: no code path may unpin evidence or delete an anchored memory. */
describe("NFR-07: no delete or unpin path", () => {
  const forbidden: Array<[string, RegExp]> = [
    ["IPFS unpin", /\bunpin\b|pinning\/unpin|\/pins?\/[^"'`]*["'`]\s*,\s*\{\s*method:\s*["']DELETE/i],
    ["HTTP DELETE to a pinning service", /method:\s*["']DELETE["']/],
    ["deleting anchors from the cache", /DELETE\s+FROM\s+(anchors|blobs)\b/i],
  ];
  it.each(forbidden)("source contains no %s", (_name, re) => {
    const hits = SOURCES.flatMap((d) => files(join(ROOT, d)))
      .filter((f) => re.test(readFileSync(f, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")))
      .map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
