import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/*
 * Builds the web app once for the tests, however many test files ask for it at the same time.
 * The build runs asynchronously (a blocking build starves the vitest worker's RPC) and behind a
 * lock directory, so two workers never build into the same folder at once.
 */

const WEB = join(__dirname, "..");
const NEXT = join(WEB, "node_modules/.bin/next");

/**
 * The env a test build and its server use: snapshot mode, and no Reown project id (no network). The default
 * build still runs Reown AppKit, as production does (NEXT_PUBLIC_WALLET_MODE=reown: browser wallets, no relay).
 */
export function webEnv(distDir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, NEXT_TELEMETRY_DISABLED: "1", NEXT_DIST_DIR: distDir };
  delete env.TYRELL_API_URL;
  delete env.NEXT_PUBLIC_REOWN_PROJECT_ID;
  delete env.TYRELL_API_TOKEN;
  if (!("NEXT_PUBLIC_WALLET_MODE" in extra)) env.NEXT_PUBLIC_WALLET_MODE = "reown";
  return env;
}

const SOURCES = ["app", "components", "lib", "content", "public", "next.config.mjs", "package.json", "postcss.config.mjs"];

/** What the build depends on: every source file (path, size, mtime) and the NEXT_PUBLIC_* env it was built with. */
function fingerprint(env: NodeJS.ProcessEnv): string {
  const h = createHash("sha256");
  const walk = (p: string) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) for (const n of readdirSync(p).sort()) walk(join(p, n));
    else h.update(`${relative(WEB, p)}\0${st.size}\0${st.mtimeMs}\n`);
  };
  for (const s of SOURCES) walk(join(WEB, s));
  for (const k of Object.keys(env).filter((x) => x.startsWith("NEXT_PUBLIC_")).sort()) h.update(`${k}=${env[k]}\n`);
  return h.digest("hex");
}

/** A build is reused only if it was made from the current sources; otherwise it is rebuilt. */
function fresh(distDir: string, want: string): boolean {
  const stamp = join(WEB, distDir, "SOURCE_FINGERPRINT");
  return existsSync(join(WEB, distDir, "BUILD_ID")) && existsSync(stamp) && readFileSync(stamp, "utf8") === want;
}

export async function ensureBuild(distDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  const want = fingerprint(env);
  const lock = join(WEB, `${distDir}.build-lock`);
  for (;;) {
    if (fresh(distDir, want)) return;
    try {
      mkdirSync(lock);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500)); // another worker is building it
    }
  }
  try {
    if (fresh(distDir, want)) return;
    rmSync(join(WEB, distDir), { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => {
      const b = spawn(NEXT, ["build"], { cwd: WEB, env });
      let out = "";
      b.stdout.on("data", (d) => (out += d));
      b.stderr.on("data", (d) => (out += d));
      b.on("close", (code) => (code === 0 ? resolve() : reject(new Error(out.slice(-4000)))));
    });
    writeFileSync(join(WEB, distDir, "SOURCE_FINGERPRINT"), want);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
