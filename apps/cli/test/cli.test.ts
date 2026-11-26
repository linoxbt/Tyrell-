import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, http, parseEther, type Address } from "viem";
import { laneRegistryAbi } from "@tyrell/chain";
import { decryptKeystore, readKeystore } from "@tyrell/storage";
import { startAnvil, type BareAnvil } from "../../../test/support/anvil.js";

const ROOT = join(__dirname, "../../..");
const TSX = join(ROOT, "node_modules/.bin/tsx");
const MAIN = join(ROOT, "apps/cli/src/main.ts");

let anvil: BareAnvil;
let homeDir: string;
let env: NodeJS.ProcessEnv;
let daemon: ChildProcess | undefined;
const logs: string[] = [];

function tyrell(...args: string[]) {
  const r = spawnSync(TSX, [MAIN, ...args], { env, encoding: "utf8", cwd: ROOT, timeout: 180_000 });
  logs.push(r.stdout, r.stderr);
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const json = (s: string) => JSON.parse(s) as Record<string, unknown>;

beforeAll(async () => {
  anvil = await startAnvil();
  homeDir = mkdtempSync(join(tmpdir(), "tyrell-cli-"));
  env = {
    ...process.env,
    TYRELL_HOME: homeDir,
    TYRELL_SCRYPT_N: "1024",
    QIE_RPC_URLS: `${anvil.url},${anvil.url}`,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`,
  };
}, 60_000);

afterAll(() => {
  daemon?.kill("SIGTERM");
  anvil?.stop();
});

describe("tyrell CLI on anvil", () => {
  it("T-02: setup keys writes distinct encrypted keys and never prints them", () => {
    const r = tyrell("setup", "keys", "--network", "local", "--chain-id", "31337", "--new-passphrase");
    expect(r.code, r.err).toBe(0);
    const pass = readFileSync(join(homeDir, "pass"), "utf8").trim();
    const roles = ["user", "agent", "wallet", "control", "submitter", "signer", "data"];
    const secrets = roles.map((role) => Buffer.from(decryptKeystore(readKeystore(join(homeDir, "keys", `${role}.json`)), pass)).toString("hex"));
    expect(new Set(secrets).size).toBe(7);
    for (const s of secrets) expect(r.out + r.err).not.toContain(s);
    expect(r.out + r.err).not.toContain(pass);
    const again = tyrell("setup", "keys", "--network", "local", "--chain-id", "31337");
    expect(again.out).toContain("created: none");
  });

  it("deploys with Foundry, roles going to the generated keys", async () => {
    const r = tyrell("deploy", "--owner", anvil.owner, "--unlocked-sender", anvil.owner);
    expect(r.code, r.err + r.out).toBe(0);
    expect(existsSync(join(homeDir, "deployment-31337.json"))).toBe(true);
    const addrs = json(readFileSync(join(homeDir, "keys", "addresses.json"), "utf8")) as Record<string, Address>;
    await createTestClient({ chain: anvil.chain, mode: "anvil", transport: http(anvil.url) }).setBalance({ address: addrs.submitter!, value: parseEther("5") });
  });

  it("T-02: registers four lane keys with the same transactions the owner page sends", async () => {
    const { pendingOwnerTxs } = await import("../src/setup.js");
    const d = json(readFileSync(join(homeDir, "deployment-31337.json"), "utf8")) as Record<string, Address>;
    const addrs = json(readFileSync(join(homeDir, "keys", "addresses.json"), "utf8")) as Record<string, Address>;
    const deployment = { ...d, chainId: 31337, startBlock: BigInt(d.startBlock as unknown as number) } as never;
    const txs = await pendingOwnerTxs(anvil.pub, deployment, addrs, 5_000_000n);
    expect(txs).toHaveLength(5);
    for (const t of txs) {
      const hash = (await anvil.pub.request({ method: "eth_sendTransaction" as never, params: [{ from: anvil.owner, to: t.to, data: t.data }] as never })) as `0x${string}`;
      await anvil.pub.waitForTransactionReceipt({ hash });
    }
    expect(await pendingOwnerTxs(anvil.pub, deployment, addrs, 5_000_000n)).toHaveLength(0);
    const events = await anvil.pub.getContractEvents({ address: d.laneRegistry!, abi: laneRegistryAbi, eventName: "LaneKeyAdded", fromBlock: 0n });
    expect(events).toHaveLength(4);
    expect(tyrell("setup", "register").out).toContain("Everything is registered");
  });

  it("starts the control daemon as its own process", async () => {
    daemon = spawn(TSX, [MAIN, "control", "start", "--refresh-ms", "60000"], { env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    daemon.stderr!.on("data", (b: Buffer) => logs.push(b.toString()));
    for (let i = 0; i < 300 && !existsSync(join(homeDir, "control.sock")); i++) await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(join(homeDir, "control.sock"))).toBe(true);
  });

  let id = "";
  it("say writes a trusted user-lane statement; status and show report it", () => {
    const r = tyrell("say", "pay rent to landlord, 5 QUSDC, on the 1st");
    expect(r.code, r.err).toBe(0);
    id = json(r.out).id as string;
    expect(id).toMatch(/^0x[0-9a-f]{32}$/);
    tyrell("status"); // triggers nothing new, but must work
    const refreshed = spawnSync(TSX, ["-e", `import("${join(ROOT, "packages/ipc/src/index.ts")}").then(m=>m.call("${join(homeDir, "control.sock")}",{type:"refresh"})).then(r=>console.log(JSON.stringify(r)))`], { env, encoding: "utf8" });
    expect(json(refreshed.stdout).memories).toBe(1);
    const s = json(tyrell("status").out);
    expect(s.classes).toEqual({ trusted: 1 });
    expect(Object.keys(s.laneKeys as object)).toHaveLength(4);
    const m = json(tyrell("show", id).out);
    expect(m).toMatchObject({ cls: "trusted", lane: 1, verification: "verified", body: "pay rent to landlord, 5 QUSDC, on the 1st" });
  });

  it("rebuild refuses to replace the live database while control runs, and works side by side", () => {
    expect(tyrell("rebuild", "--fresh").err).toContain("control is running");
    const r = tyrell("rebuild", "--fresh", "--out", join(homeDir, "side.sqlite"));
    expect(r.code, r.err).toBe(0);
    expect(json(r.out)).toMatchObject({ memories: 1, verified: 1, visible: 1 });
  });

  it("T-14 via the CLI: verify --head compares live and rebuilt digests", () => {
    const head = (json(tyrell("status").out).head as string) ?? "0";
    const r = tyrell("verify", "--head", head);
    expect(r.code, r.err + r.out).toBe(0);
    expect(json(r.out)).toMatchObject({ match: true });
  });

  it("no command ever printed a private key or the passphrase", () => {
    const pass = readFileSync(join(homeDir, "pass"), "utf8").trim();
    const all = logs.join("\n");
    for (const role of ["user", "agent", "wallet", "control", "submitter", "signer", "data"]) {
      const secret = Buffer.from(decryptKeystore(readKeystore(join(homeDir, "keys", `${role}.json`)), pass)).toString("hex");
      expect(all).not.toContain(secret);
    }
    expect(all).not.toContain(pass);
  });
});
