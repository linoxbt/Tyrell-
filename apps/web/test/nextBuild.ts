import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/*
 * Builds the web app once for the tests, however many test files ask for it at the same time.
 * The build runs asynchronously (a blocking build starves the vitest worker's RPC) and behind a
 * lock directory, so two workers never build into the same folder at once.
 */

const WEB = join(__dirname, "..");
const NEXT = join(WEB, "node_modules/.bin/next");

/** The env a test build and its server use: snapshot mode and no Reown project id (no network). */
export function webEnv(distDir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, NEXT_TELEMETRY_DISABLED: "1", NEXT_DIST_DIR: distDir };
  delete env.TYRELL_API_URL;
  delete env.NEXT_PUBLIC_REOWN_PROJECT_ID;
  if (!("NEXT_PUBLIC_WALLET_MODE" in extra)) delete env.NEXT_PUBLIC_WALLET_MODE;
  return env;
}

export async function ensureBuild(distDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  const done = join(WEB, distDir, "BUILD_ID");
  const lock = join(WEB, `${distDir}.build-lock`);
  for (;;) {
    if (existsSync(done)) return;
    try {
      mkdirSync(lock);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500)); // another worker is building it
    }
  }
  try {
    if (existsSync(done)) return;
    await new Promise<void>((resolve, reject) => {
      const b = spawn(NEXT, ["build"], { cwd: WEB, env });
      let out = "";
      b.stdout.on("data", (d) => (out += d));
      b.stderr.on("data", (d) => (out += d));
      b.on("close", (code) => (code === 0 ? resolve() : reject(new Error(out.slice(-4000)))));
    });
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
