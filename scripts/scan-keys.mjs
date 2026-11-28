#!/usr/bin/env node
// NFR-01: refuse commits that contain anything shaped like a private key or an API credential.
//   --staged   scan lines added in the staged diff (pre-commit hook)
//   --history  scan every line ever added on any branch (submission checklist)
// A 32-byte hex value that is public (an event topic, a hash) can be kept by
// putting "key-scan: allow" on the same line.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const RULES = [
  { name: "32-byte hex (possible private key)", re: /(?<![0-9a-fA-Fx])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/ },
  { name: "PEM private key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: "keystore ciphertext", re: /"ciphertext"\s*:\s*"[0-9a-fA-F]{32,}"/ },
  // API credentials (S-14): provider keys, JWTs (Pinata), bearer tokens and key-looking assignments.
  { name: "API key (sk-...)", re: /\bsk-(?:ant-|proj-|ft-|live-)?[A-Za-z0-9_-]{24,}/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "bearer token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{32,}=*/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "secret assignment", re: /(?:api[_-]?key|secret|token|passw(?:or)?d)["']?\s*[:=]\s*["'][A-Za-z0-9_+/=-]{24,}["']/i },
];
const ALLOW = "key-scan: allow";

// Paths listed in .key-scan-allow (globs: * within a segment) hold only public 32-byte values.
const globToRe = (g) => new RegExp("^" + g.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");
const allowedPaths = existsSync(".key-scan-allow")
  ? readFileSync(".key-scan-allow", "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map(globToRe)
  : [];
const pathAllowed = (f) => allowedPaths.some((re) => re.test(f));

const mode = process.argv[2] ?? "--staged";
const args =
  mode === "--history"
    ? ["log", "-p", "--all", "-U0", "--no-color", "--format=commit %H"]
    : ["diff", "--cached", "-U0", "--no-color"];

const diff = execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 30 });
let where = "", file = "";
const hits = [];
for (const line of diff.split("\n")) {
  if (line.startsWith("commit ")) where = line.slice(7, 19);
  else if (line.startsWith("+++ ")) file = line.slice(6);
  else if (line.startsWith("+") && !line.includes(ALLOW) && !pathAllowed(file)) {
    for (const r of RULES) if (r.re.test(line)) hits.push(`${where ? where + " " : ""}${file}: ${r.name}`);
  }
}

if (hits.length) {
  console.error(`scan-keys: ${hits.length} possible secret(s) found:`);
  for (const h of [...new Set(hits)]) console.error("  " + h);
  console.error(`If a value is public, add "${ALLOW}" on its line.`);
  process.exit(1);
}
console.log(`scan-keys: clean (${mode})`);
