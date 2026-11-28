import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");
const SOURCES = ["packages", "apps", "scripts"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    // our source only: dependencies and build output (Next.js bundles third-party HTTP clients) are not code paths we own
    if (name === "node_modules" || name === "dist" || name === "test" || name.startsWith(".next") || name === ".vercel") return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mts|mjs|js|jsx)$/.test(name) ? [p] : [];
  });
}

/** The source with comments removed, using the TypeScript scanner (so "https://" inside a string is kept). */
export function withoutComments(text: string, jsx = true): string {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, false, jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
  let out = "";
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) {
    if (k === ts.SyntaxKind.SingleLineCommentTrivia || k === ts.SyntaxKind.MultiLineCommentTrivia) continue;
    out += sc.getTokenText();
  }
  return out;
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
      .filter((f) => re.test(withoutComments(readFileSync(f, "utf8"), /x$/.test(f))))
      .map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("a URL in a string does not hide the rest of the line, and comments still don't count", () => {
    const sneaky = 'await fetch("https://api.pinata.cloud/pins/x", { method: "DELETE" });';
    expect(forbidden[1]![1].test(withoutComments(sneaky))).toBe(true);
    expect(forbidden[1]![1].test(withoutComments('// fetch(url, { method: "DELETE" })\nconst a = 1;'))).toBe(false);
    expect(forbidden[0]![1].test(withoutComments("/* unpin is never called */ const b = 2;"))).toBe(false);
  });
});
