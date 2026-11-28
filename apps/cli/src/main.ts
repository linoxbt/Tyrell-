#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, InvalidArgumentError } from "commander";
import { getAddress, isAddress, type Address } from "viem";
import { encode } from "@tyrell/ipc";
import { blobStore, clients, deployment, passphrase, paths, readConfig, type TyrellConfig } from "./config.js";
import { ownerPageHtml, pendingOwnerTxs, serveOwnerPage, setupKeys } from "./setup.js";
import { deploy } from "./deploy.js";
import { startDaemon } from "./daemon.js";
import { rebuild, say, show, status, verifyDigest } from "./commands.js";
import { payeeAdd, payeeList, payeeReinstate, payeeRemove, release, startSigner, stewardTurn } from "./agent.js";
import { blast, finishRotation, incidents, ingestScan, mermaid, parseSeed, quarantineCmd, revokeTxs } from "./response.js";
import { attackTable, runAttacks } from "./attacks.js";
import { capsCheck, evidence, signerLeakDrill } from "./mainnet.js";
import * as nw from "./network.js";
import { McpQieIdResolver } from "./payee.js";
import { account } from "./config.js";
import { agentNetworkAbi, agentRegistryAbi, laneRegistryAbi } from "@tyrell/chain";
import { agentRegistrationSigner, codeText, messageBodyHash, signAgentMessage, signAgentRegistration } from "@tyrell/core";
import { erc20Abi, type Hex } from "viem";
import { join } from "node:path";
import type { OwnerTx } from "./setup.js";

const print = (v: unknown) => console.log(JSON.stringify(JSON.parse(encode(v)), (_k, x) => (x && typeof x === "object" && "$bigint" in x ? x.$bigint : x), 2));
const addressArg = (v: string): Address => {
  if (!isAddress(v)) throw new InvalidArgumentError("not an address");
  return getAddress(v);
};
const blockArg = (v: string): bigint => {
  if (!/^\d+$/.test(v)) throw new InvalidArgumentError("not a block number");
  return BigInt(v);
};
const run = <A extends unknown[]>(f: (...a: A) => Promise<unknown>) => async (...a: A) => {
  try {
    await f(...a);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

const program = new Command("tyrell").description("Provenance and quarantine for an agent's memory, with payments enforced on QIE").version("0.1.0");

type KeysOpts = { network: TyrellConfig["network"]; chainId?: string; store: string; gateway?: string; newPassphrase?: boolean };
type RegisterOpts = { dailyCap: string; port: string; mint?: string };

function setupKeysCmd(o: KeysOpts) {
  const store: TyrellConfig["store"] = o.store === "pinata" ? { kind: "pinata", ...(o.gateway ? { gateway: o.gateway } : {}) } : { kind: "dir", dir: paths().blobs };
  const r = setupKeys(
    {
      network: o.network,
      ...(o.chainId ? { chainId: Number(o.chainId) } : {}),
      store,
      ...(o.newPassphrase ? { newPassphrase: true } : {}),
      ...(process.env.TYRELL_SCRYPT_N ? { scryptN: Number(process.env.TYRELL_SCRYPT_N) } : {}),
    },
    passphrase,
  );
  console.log(`Keys in ${paths().keys} (created: ${r.created.join(", ") || "none"}; already there: ${r.existing.join(", ") || "none"})`);
  for (const [role, a] of Object.entries(r.addresses)) console.log(`  ${role.padEnd(9)} ${a}`);
  console.log(`Account id ${r.acct}`);
}

async function setupRegisterCmd(o: RegisterOpts) {
  const c = readConfig();
  const d = deployment(c);
  const pub = clients(c)[0]!;
  const addrs = JSON.parse(readFileSync(paths().addresses, "utf8")) as Record<string, Address>;
  const cap = BigInt(o.dailyCap);
  const testToken = (JSON.parse(readFileSync(c.deploymentFile ?? join(paths().home, `deployment-${c.chainId}.json`), "utf8")) as { testToken?: boolean }).testToken === true;
  if (o.mint && !testToken) throw new Error("--mint only works with the testnet TyrellTestUSD token");
  const mint = o.mint ? BigInt(o.mint) : undefined;
  const txs = await pendingOwnerTxs(pub, d, addrs, cap, mint);
  if (txs.length === 0) return void console.log("Everything is registered.");
  const html = ownerPageHtml({ chainId: c.chainId, chainName: c.network === "mainnet" ? "QIE Mainnet" : c.network === "testnet" ? "QIE Testnet" : "Local", rpcUrls: c.rpcs.slice(0, 2), owner: d.owner, txs });
  const { url, server } = await serveOwnerPage(html, Number(o.port));
  console.log(`Open ${url} in the browser that has QIE Wallet (owner ${d.owner}). ${txs.length} transaction(s):`);
  for (const t of txs) console.log(`  - ${t.label}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 4_000));
    if ((await pendingOwnerTxs(pub, d, addrs, cap, mint)).length === 0) break;
  }
  server.close();
  console.log("Registered: four lane keys active and the vault cap set.");
}

// Options are positional, so `setup keys --network local` reaches `keys` and not `setup`, which has
// options of the same names.
program.enablePositionalOptions();
const setup = program
  .command("setup")
  .enablePositionalOptions()
  .description("Generate keys and, once deployed, register them on-chain (`setup keys` and `setup register` run the two steps alone)")
  .option("--network <name>", "mainnet | testnet | local", "testnet")
  .option("--chain-id <id>", "override the chain id (local only)")
  .option("--store <kind>", "dir | pinata", "dir")
  .option("--gateway <url>", "Pinata dedicated gateway")
  .option("--new-passphrase", "create random passphrases where none exist (TYRELL_HOME/pass.d/<role> on testnet and mainnet; TYRELL_HOME/pass on a local chain)")
  .option("--daily-cap <units>", "vault-wide daily cap in token base units", "5000000")
  .option("--mint <units>", "testnet only: fund the vault with TyrellTestUSD up to this many base units")
  .option("--port <port>", "local port", "0")
  .action(
    run(async (o: KeysOpts & RegisterOpts) => {
      setupKeysCmd(o);
      const c = readConfig();
      const { existsSync } = await import("node:fs");
      if (!existsSync(c.deploymentFile ?? join(paths().home, `deployment-${c.chainId}.json`))) {
        console.log("Next: fund the submitter with a little QIEV3 for gas, run `tyrell deploy`, then `tyrell setup` again (or `tyrell setup register`).");
        return;
      }
      await setupRegisterCmd(o);
    }),
  );
setup
  .command("keys")
  .description("Generate one encrypted keystore per role (user, agent, wallet, control, submitter, signer, data)")
  .option("--network <name>", "mainnet | testnet | local", "testnet")
  .option("--chain-id <id>", "override the chain id (local only)")
  .option("--store <kind>", "dir | pinata", "dir")
  .option("--gateway <url>", "Pinata dedicated gateway")
  .option("--new-passphrase", "create random passphrases where none exist (TYRELL_HOME/pass.d/<role> on testnet and mainnet; TYRELL_HOME/pass on a local chain)")
  .action(
    run(async (o: KeysOpts) => {
      setupKeysCmd(o);
      console.log("Next: fund the submitter with a little QIEV3 for gas, then `tyrell deploy`.");
    }),
  );

setup
  .command("register")
  .description("Open a local page that registers the lane keys and the vault cap from QIE Wallet")
  .option("--daily-cap <units>", "vault-wide daily cap in token base units", "5000000")
  .option("--mint <units>", "testnet only: fund the vault with TyrellTestUSD up to this many base units")
  .option("--port <port>", "local port", "0")
  .action(run(async (o: RegisterOpts) => setupRegisterCmd(o)));

program
  .command("probe")
  .description("Probe the QIE endpoints Tyrell depends on (RPCs, log windows, explorer, MCP) and print the report (see PROBE.md)")
  .action(
    run(async () => {
      const { spawnSync } = await import("node:child_process");
      const script = join(import.meta.dirname, "../../../scripts/probe.ts");
      const r = spawnSync(process.execPath, ["--import", "tsx", script], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? "1" } });
      if (r.status) process.exitCode = r.status;
    }),
  );

program
  .command("keys")
  .description("Key files")
  .command("migrate")
  .description("Add the role MAC to keystores written by an older Tyrell (needs each role's passphrase)")
  .action(
    run(async () => {
      const { existsSync, writeFileSync, renameSync } = await import("node:fs");
      const { migrateKeystore, readKeystore } = await import("@tyrell/storage");
      const { ROLES, passphrase, assertPrivate } = await import("./config.js");
      for (const role of ROLES) {
        const p = paths().key(role);
        if (!existsSync(p)) continue;
        assertPrivate(p, "key file");
        const ks = readKeystore(p);
        if (ks.tyrell?.mac) {
          console.log(`  ${role.padEnd(9)} already bound`);
          continue;
        }
        const next = migrateKeystore(ks, passphrase(role), role);
        writeFileSync(`${p}.tmp`, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
        renameSync(`${p}.tmp`, p);
        console.log(`  ${role.padEnd(9)} migrated`);
      }
    }),
  );

program
  .command("deploy")
  .description("Deploy the four contracts with Foundry, roles going to the keys from `setup keys`")
  .requiredOption("--owner <address>", "your QIE Wallet address", addressArg)
  .option("--account <name>", "Foundry keystore name of a funded throwaway deployer")
  .option("--unlocked-sender <address>", "local chains only: deploy from an unlocked node account", addressArg)
  .option("--token <address>", "payment token (QUSDC on mainnet)", addressArg)
  .option("--verify", "verify sources on the QIE explorer (Blockscout)")
  .action(
    run(async (o: { owner: Address; account?: string; unlockedSender?: Address; token?: Address; verify?: boolean }) => {
      const file = deploy({
        owner: o.owner,
        ...(o.account ? { account: o.account } : {}),
        ...(o.unlockedSender ? { unlockedSender: o.unlockedSender } : {}),
        ...(o.token ? { token: o.token } : {}),
        ...(o.verify ? { verify: true } : {}),
      });
      console.log(`Deployment written to ${file}. Next: \`tyrell setup register\`.`);
    }),
  );

const control = program.command("control").description("The control process");
control
  .command("start")
  .option("--refresh-ms <ms>", "projection refresh interval", "15000")
  .action(
    run(async (o: { refreshMs: string }) => {
      const dmn = await startDaemon({ refreshMs: Number(o.refreshMs) });
      const stop = () => void dmn.stop().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      await new Promise(() => undefined);
    }),
  );

const signerCmd = program.command("signer").description("The vault signer process");
signerCmd.command("start").action(
  run(async () => {
    const server = await startSigner();
    const stop = () => server.close(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    await new Promise(() => undefined);
  }),
);

program
  .command("steward <task>")
  .description("Run one Steward turn (agent key only; needs LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)")
  .action(
    run(async (task: string) => {
      const t = await stewardTurn(task);
      print({ turn: t.turn, readSet: t.readSet, writes: t.writes, decisions: t.decisions, final: t.final });
    }),
  );

const payee = program.command("payee").description("Manage payees (signed with the user key in this process)");
payee
  .command("add")
  .requiredOption("--label <label>", "e.g. landlord")
  .option("--qie-id <id>", "QIE ID, resolved once now and required to round-trip")
  .option("--address <0x>", "raw address instead of a QIE ID", addressArg)
  .option("--token <address>", "payee token (default: the vault token)", addressArg)
  .requiredOption("--cap <amount>", "per-payment cap in token units")
  .requiredOption("--daily <amount>", "daily cap in token units")
  .option("--confirm <last6>", "last 6 characters of the address (prompted for if omitted)")
  .action(
    run(async (o: { label: string; qieId?: string; address?: Address; token?: Address; cap: string; daily: string; confirm?: string }) =>
      print(
        await payeeAdd({
          label: o.label,
          cap: o.cap,
          daily: o.daily,
          ...(o.qieId ? { qieId: o.qieId } : {}),
          ...(o.address ? { address: o.address } : {}),
          ...(o.token ? { token: o.token } : {}),
          ...(o.confirm ? { confirm: o.confirm } : {}),
        }),
      ),
    ),
  );
payee.command("list").action(run(async () => print(await payeeList())));
payee.command("remove <label>").action(run(async (label: string) => print(await payeeRemove(label))));
payee.command("reinstate <label>").action(run(async (label: string) => print(await payeeReinstate(label))));

program
  .command("release <seedId>")
  .description("Release a quarantine seed (user key); the reason is recorded as your statement and its CID goes on-chain")
  .option("--reason <text>", "why the seed is released")
  .option("--reason-cid <cid>", "an existing IPFS CID for the reason, instead of --reason")
  .action(
    run(async (seedId: string, o: { reason?: string; reasonCid?: string }) =>
      print(await release(BigInt(seedId), { ...(o.reason ? { reason: o.reason } : {}), ...(o.reasonCid ? { reasonCid: o.reasonCid } : {}) })),
    ),
  );

const ingest = program.command("ingest").description("The ingest worker (wallet key only)");
ingest
  .command("scan")
  .description("One sentinel pass: new transfers, metadata and MCP reads, written through the wallet lane, then scored")
  .option("--from <block>", "start block (default: after the last scan)", blockArg)
  .option("--mcp", "also read balances through the QIE MCP server")
  .action(run(async (o: { from?: bigint; mcp?: boolean }) => print(await ingestScan(o))));
ingest
  .command("start")
  .option("--poll-ms <ms>", "poll interval", process.env.SENTINEL_POLL_MS ?? "15000")
  .option("--mcp", "also read balances through the QIE MCP server")
  .action(
    run(async (o: { pollMs: string; mcp?: boolean }) => {
      for (;;) {
        try {
          const r = await ingestScan({ ...(o.mcp ? { mcp: true } : {}) });
          if (r.observations.length) console.error(`ingest: ${r.observations.length} observation(s), ${r.incidents.length} incident(s) in blocks ${r.from}-${r.to}`);
        } catch (e) {
          console.error(`ingest: ${(e as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, Number(o.pollMs)));
      }
    }),
  );

program.command("incidents").description("Sentinel incidents recorded by control").action(run(async () => print(await incidents())));

program
  .command("quarantine")
  .description("Seed a quarantine (control key) after a blast-radius preview")
  .option("--source <ref>", "token contract, NFT contract, sender address or tx hash")
  .option("--memory <id>", "one memory id")
  .option("--signer-window <spec>", "<address>:<fromBlock>-<toBlock>")
  .option("--turn <id>", "every write from one Steward turn")
  .requiredOption("--reason <text>", "why; sealed and pinned, its CID goes on-chain")
  .option("--yes", "do not ask for confirmation")
  .action(
    run(async (o: { source?: string; memory?: string; signerWindow?: string; turn?: string; reason: string; yes?: boolean }) =>
      print(await quarantineCmd(parseSeed(o), o.reason, !!o.yes)),
    ),
  );

program
  .command("blast <seedId>")
  .description("Print the blast radius of a seed, and where to see it in the console")
  .option("--mermaid", "print a Mermaid graph instead of JSON")
  .option("--open", "open the console's blast-radius view in the browser")
  .action(
    run(async (seedId: string, o: { mermaid?: boolean; open?: boolean }) => {
      const b = await blast(Number(seedId));
      if (o.mermaid) console.log(mermaid(b));
      else print(b);
      // The console (apps/web, `pnpm web:dev`) reads control's local view; TYRELL_CONSOLE_URL points elsewhere.
      const url = `${(process.env.TYRELL_CONSOLE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/console?tab=blast&seed=${Number(seedId)}`;
      console.error(`Blast radius in the console: ${url}`);
      if (o.open) {
        const { spawn } = await import("node:child_process");
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
        spawn(cmd, [url], { stdio: "ignore", detached: true }).on("error", () => console.error(`could not run ${cmd}; open the URL above`)).unref();
      }
    }),
  );

program
  .command("revoke")
  .description("Revoke or rotate a lane key from QIE Wallet (owner)")
  .requiredOption("--lane <role>", "user | agent | wallet | control")
  .option("--rotate", "register a freshly generated key in the same transaction")
  .option("--reason <text>", "recorded on-chain", "suspected compromise")
  .option("--port <port>", "local port", "0")
  .action(
    run(async (o: { lane: string; rotate?: boolean; reason: string; port: string }) => {
      const c = readConfig();
      const d = deployment(c);
      const pub = clients(c)[0]!;
      const r = await revokeTxs(pub, d, o.lane, !!o.rotate, o.reason);
      const html = ownerPageHtml({ chainId: c.chainId, chainName: c.network, rpcUrls: c.rpcs.slice(0, 2), owner: d.owner, txs: r.txs });
      const { url, server } = await serveOwnerPage(html, Number(o.port));
      console.log(`Open ${url} with QIE Wallet (owner ${d.owner}): ${r.txs[0]!.label}`);
      for (;;) {
        await new Promise((res) => setTimeout(res, 4_000));
        const active = await pub.readContract({ address: d.laneRegistry, abi: (await import("@tyrell/chain")).laneRegistryAbi, functionName: "isActiveFor", args: [r.oldKey, ({ user: 1, agent: 2, wallet: 3, control: 4 } as Record<string, number>)[o.lane]!] });
        if (!active) break;
      }
      server.close();
      if (r.newKey) {
        await finishRotation(pub, d, o.lane, r.newKey);
        console.log(`Rotated: ${o.lane} is now ${r.newKey}; the old key file is in keys/retired. Restart the ${o.lane} process.`);
      } else {
        console.log(`Revoked ${r.oldKey}: MemoryAnchor refuses anything it signs from now on.`);
      }
    }),
  );

program
  .command("attack")
  .description("The attack set (T-20)")
  .command("run")
  .option("--variant <n>", "run one variant")
  .option("--markdown", "print the result table as Markdown")
  .action(
    run(async (o: { variant?: string; markdown?: boolean }) => {
      const rs = await runAttacks({ ...(o.variant ? { only: Number(o.variant) } : {}) });
      if (o.markdown) console.log(attackTable(rs));
      else print(rs);
      if (rs.some((r) => !r.pass)) process.exitCode = 3;
    }),
  );

program
  .command("check")
  .description("Pre-funding checks")
  .command("caps")
  .description("NFR-08: worst-case daily loss = min(vault cap, sum of payee daily caps, balance)")
  .option("--max <units>", "the most you accept losing in a day, in token units", "20")
  .action(
    run(async (o: { max: string }) => {
      const r = await capsCheck(o.max);
      print(r);
      if (!r.ok) process.exitCode = 4;
    }),
  );

program
  .command("drill")
  .description("Demo drills")
  .command("signer-leak")
  .description("The vault signer key pays an unregistered address directly; the vault reverts on-chain")
  .option("--amount <units>", "amount in token units", "1")
  .action(run(async (o: { amount: string }) => print(await signerLeakDrill(o.amount))));

program
  .command("snapshot")
  .description("Write the web view's document to a file (read-only demo mode); memory contents are left out unless --include-bodies")
  .requiredOption("--out <file>", "e.g. apps/web/public/snapshot.json")
  .option("--include-bodies", "keep memory bodies, decision reasons and incident summaries in plain text (only for demo data you mean to publish)")
  .action(
    run(async (o: { out: string; includeBodies?: boolean }) => {
      const { call } = await import("@tyrell/ipc");
      const { writeFileSync } = await import("node:fs");
      const { redactView } = await import("@tyrell/control");
      const doc = (await call(paths().socket, { type: "view" })) as Parameters<typeof redactView>[0];
      writeFileSync(o.out, JSON.stringify(o.includeBodies ? doc : redactView(doc), null, 2) + "\n");
      console.log(`wrote ${o.out}${o.includeBodies ? " (with memory bodies in plain text)" : " (memory contents left out)"}`);
    }),
  );

program.command("evidence").description("Contract links and example transactions for the submission").action(run(async () => print(await evidence())));

program
  .command("say <text>")
  .description("Write a user-lane statement (signed with the user key in this process)")
  .action(run(async (text: string) => print(await say(text))));

program.command("status").description("Contracts, lane keys, head, digest, classes, seeds").action(run(async () => print(await status())));

program
  .command("show <memoryId>")
  .description("Envelope, verification, class and lineage of one memory")
  .option("--forensic", "show excluded memories too")
  .action(run(async (id: string, o: { forensic?: boolean }) => print(await show(id, !!o.forensic))));

program
  .command("rebuild")
  .description("Rebuild the projection from QIE and IPFS alone and print the digest")
  .requiredOption("--fresh", "delete the local database first (required)")
  .option("--out <path>", "write the rebuilt database here instead of the live path")
  .option("--head <block>", "rebuild as of this block", blockArg)
  .action(
    run(async (o: { out?: string; head?: bigint }) => {
      const r = await rebuild({ ...(o.out ? { out: o.out } : {}), ...(o.head !== undefined ? { head: o.head } : {}) });
      print({ head: r.head, digest: r.digest, ms: Math.round(r.ms), ...r.counts });
    }),
  );

program
  .command("verify")
  .description("Compare the live digest with a fresh rebuild at the same head; exits non-zero on mismatch")
  .requiredOption("--head <block>", "block to compare at", blockArg)
  .action(
    run(async (o: { head: bigint }) => {
      const r = await verifyDigest(o.head);
      print(r);
      if (!r.match) process.exitCode = 2;
    }),
  );

program
  .command("store-check")
  .description("Pin and fetch a test blob through the configured store")
  .action(
    run(async () => {
      const store = blobStore(readConfig());
      const t0 = performance.now();
      const cid = await store.put(new TextEncoder().encode(`tyrell store check ${Date.now()}`));
      await store.get(cid);
      console.log(`${store.name}: ${cid} round-trip ${Math.round(performance.now() - t0)} ms`);
    }),
  );


// ------------------------------------------------------------------ agents network (phase A and B)

/**
 * Send owner transactions from QIE Wallet through the local owner page, then wait for each one's receipt
 * (matched on-chain by sender, target and calldata). Fails on the first revert, and gives up after
 * `--timeout` seconds instead of hanging if the wallet rejected a prompt.
 */
async function ownerSend(txs: OwnerTx[], port = "0", timeoutSec = process.env.TYRELL_OWNER_TIMEOUT ?? "600") {
  const c = readConfig();
  const d = deployment(c);
  const pub = clients(c)[0]!;
  const from = await pub.getBlockNumber({ cacheTime: 0 });
  const html = ownerPageHtml({ chainId: c.chainId, chainName: c.network === "mainnet" ? "QIE Mainnet" : c.network === "testnet" ? "QIE Testnet" : "Local", rpcUrls: c.rpcs.slice(0, 2), owner: d.owner, txs });
  const { url, server } = await serveOwnerPage(html, Number(port));
  console.log(`Open ${url} in the browser that has QIE Wallet (owner ${d.owner}). ${txs.length} transaction(s):`);
  for (const t of txs) console.log(`  - ${t.label}`);
  try {
    const hashes = await nw.waitForOwnerTxs(pub, d.owner, txs, from, { timeoutMs: Number(timeoutSec) * 1000, log: (s) => console.log(s) });
    console.log("Done.");
    return hashes;
  } finally {
    server.close();
  }
}

const ctx = () => {
  const c = readConfig();
  return { c, d: deployment(c), pub: clients(c)[0]! };
};
const tokenUnits = async (amount: string) => {
  const { d, pub } = ctx();
  const decimals = await pub.readContract({ address: d.token, abi: erc20Abi, functionName: "decimals" });
  return nw.units(amount, decimals);
};
const hexArg = (v: string): Hex => {
  if (!/^0x[0-9a-fA-F]*$/.test(v)) throw new InvalidArgumentError("not hex");
  return v as Hex;
};

const agentsCmd = program.command("agents").description("Agents network phase A: your QIE ID binding, your agents, their limits and your shared quota");
agentsCmd.command("list").description("Your QIE ID binding, quota and agents with live status").action(run(async () => print(await nw.agentsReport(ctx().pub, ctx().d))));
agentsCmd
  .command("bind <qieId>")
  .description("Bind your owner account to your QIE ID (verified on-chain against the QIE ID record store)")
  .option("--port <port>", "local port", "0")
  .action(
    run(async (qieId: string, o: { port: string }) => {
      const { c, d } = ctx();
      const test = (JSON.parse(readFileSync(c.deploymentFile!, "utf8")) as { testQieId?: boolean }).testQieId === true;
      if (c.network === "mainnet") {
        const r = new McpQieIdResolver();
        const a = await r.resolve(qieId);
        await r.close?.();
        if (!a || a.toLowerCase() !== d.owner.toLowerCase()) throw new Error(`${qieId} resolves to ${a ?? "nobody"}, not your owner address ${d.owner}`);
      }
      await ownerSend(nw.bindTxs(d, qieId, test), o.port);
    }),
  );
agentsCmd
  .command("consent <human>")
  .description("Sign, with this deployment's agent key, its consent to be registered as <human>'s agent (give the JSON to that human)")
  .option("--ttl <seconds>", "valid for", "86400")
  .action(
    run(async (human: string, o: { ttl: string }) => {
      const { d, pub } = ctx();
      if (!d.agentRegistry) throw new Error("this deployment is not linked to an agents network: run `tyrell network link`");
      const deadline = (await pub.getBlock()).timestamp + BigInt(o.ttl);
      const key = account("steward", "agent");
      const signature = await signAgentRegistration(key, d.chainId, d.agentRegistry, addressArg(human), deadline);
      print({ human: addressArg(human), key: key.address, deadline, signature });
    }),
  );
agentsCmd
  .command("register")
  .description("Register an agent under you (default: this deployment's agent-lane key, recorded as this deployment's agent)")
  .requiredOption("--label <label>", "a name for people")
  .requiredOption("--per-tx <amount>", "most the agent may pay at once, in token units")
  .requiredOption("--daily <amount>", "most the agent may spend per UTC day, in token units")
  .option("--key <address>", "the agent's key (another deployment's agent-lane key; needs --key-sig)", addressArg)
  .option("--key-sig <hex>", "that key's consent, from `tyrell agents consent <your owner address>` on its deployment", hexArg)
  .option("--sig-deadline <unix>", "the consent's deadline (from the same JSON)")
  .option("--perms <list>", "pay, memory, message, deal", "pay,memory")
  .option("--any-payee", "may pay any registered payee (default: only delegated payees)")
  .option("--model <text>", "model/operator description, stored as a hash")
  .option("--port <port>", "local port", "0")
  .action(
    run(async (o: { label: string; perTx: string; daily: string; key?: Address; keySig?: Hex; sigDeadline?: string; perms: string; anyPayee?: boolean; model?: string; port: string }) => {
      const { c, d, pub } = ctx();
      if (!d.agentRegistry) throw new Error("this deployment is not linked to an agents network: run `tyrell network link`");
      const laneKey = await pub.readContract({ address: d.laneRegistry, abi: laneRegistryAbi, functionName: "activeKey", args: [2] });
      const key = getAddress(o.key ?? laneKey);
      const own = key.toLowerCase() === laneKey.toLowerCase();
      let deadline: bigint;
      let keySig: Hex;
      if (o.keySig) {
        if (!o.sigDeadline || !/^\d+$/.test(o.sigDeadline)) throw new InvalidArgumentError("--key-sig needs --sig-deadline");
        deadline = BigInt(o.sigDeadline);
        keySig = o.keySig;
        const signer = await agentRegistrationSigner(d.chainId, d.agentRegistry, d.owner, key, deadline, keySig);
        if (signer.toLowerCase() !== key.toLowerCase()) throw new Error(`--key-sig was signed by ${signer}, not by ${key} for owner ${d.owner}`);
      } else if (own) {
        deadline = (await pub.getBlock()).timestamp + 3_600n;
        keySig = await signAgentRegistration(account("steward", "agent"), d.chainId, d.agentRegistry, d.owner, deadline);
      } else {
        throw new Error("another deployment's key needs its consent: run `tyrell agents consent <your owner address>` there and pass --key-sig and --sig-deadline");
      }
      const t = nw.registerTx(d, {
        key,
        token: d.token,
        label: o.label,
        perms: nw.parsePerms(o.perms),
        perTx: await tokenUnits(o.perTx),
        daily: await tokenUnits(o.daily),
        anyPayee: !!o.anyPayee,
        deadline,
        keySig,
        ...(o.model ? { model: o.model } : {}),
      });
      await ownerSend([t], o.port);
      const id = await nw.registeredAgentId(pub, d, key);
      if (own) {
        nw.linkNetwork(c, "", id);
        console.log(`This deployment is now agent #${id}. Next: \`tyrell agents link-vault\` (payments then go through GuardedVault.payForAgent).`);
      } else console.log(`Registered agent #${id}.`);
    }),
  );
agentsCmd
  .command("link-vault")
  .description("Link this deployment to its agent: the vault charges it (payForAgent only), agent memories need its memory permission, deals may charge it")
  .option("--port <port>", "local port", "0")
  .action(run(async (o: { port: string }) => ownerSend(nw.spenderTxs(ctx().d), o.port)));
agentsCmd.command("quota <daily>").description("Your daily quota in token units, shared by all your agents").option("--port <port>", "local port", "0").action(run(async (daily: string, o: { port: string }) => ownerSend([nw.quotaTx(ctx().d, ctx().d.token, await tokenUnits(daily))], o.port)));
agentsCmd.command("limits <agentId> <perTx> <daily>").description("Set an agent's per-payment and daily limits (token units)").option("--port <port>", "local port", "0").action(run(async (id: string, perTx: string, daily: string, o: { port: string }) => ownerSend([nw.limitsTx(ctx().d, BigInt(id), await tokenUnits(perTx), await tokenUnits(daily))], o.port)));
agentsCmd.command("perms <agentId> <list>").description("Set permissions: pay, memory, message, deal").option("--port <port>", "local port", "0").action(run(async (id: string, list: string, o: { port: string }) => ownerSend([nw.permsTx(ctx().d, BigInt(id), nw.parsePerms(list))], o.port)));
agentsCmd
  .command("payees <agentId> <labels>")
  .description("Delegate payees (comma-separated labels; #N for agent N as a deal counterparty)")
  .option("--remove", "withdraw instead of delegate")
  .option("--port <port>", "local port", "0")
  .action(run(async (id: string, labels: string, o: { remove?: boolean; port: string }) => ownerSend([nw.payeesTx(ctx().d, BigInt(id), labels.split(",").map((x) => x.trim()), !o.remove)], o.port)));
agentsCmd.command("any-payee <agentId> <onOff>").description("Allow an agent to pay any registered payee (on) or only delegated ones (off)").option("--port <port>", "local port", "0").action(run(async (id: string, v: string, o: { port: string }) => ownerSend([nw.anyPayeeTx(ctx().d, BigInt(id), v === "on")], o.port)));
agentsCmd.command("revoke <agentId>").description("Revoke one agent for good (its key can never be reused)").option("--reason <text>", "recorded on-chain", "revoked by its human").option("--port <port>", "local port", "0").action(run(async (id: string, o: { reason: string; port: string }) => ownerSend([nw.revokeAgentTx(ctx().d, BigInt(id), o.reason)], o.port)));
agentsCmd.command("freeze").description("Stop all of your agents at once").option("--port <port>", "local port", "0").action(run(async (o: { port: string }) => ownerSend([nw.freezeTx(ctx().d, true)], o.port)));
agentsCmd.command("unfreeze").description("Restart your agents").option("--port <port>", "local port", "0").action(run(async (o: { port: string }) => ownerSend([nw.freezeTx(ctx().d, false)], o.port)));

const networkCmd = program.command("network").description("Agents network phase B: deploy, bonds, reports and disputes, deals, reputation, agent messages");
networkCmd
  .command("deploy")
  .description("Deploy AgentRegistry and AgentNetwork once per chain (a TestQieId off mainnet)")
  .requiredOption("--arbiter <address>", "who decides contested reports and disputed deals", addressArg)
  .option("--admin <address>", "council that can replace the arbiter (required on mainnet; default: the arbiter)", addressArg)
  .option("--bond-token <address>", "bond token (default: this deployment's token)", addressArg)
  .option("--account <name>", "Foundry keystore of a funded deployer")
  .option("--unlocked-sender <address>", "local chains: an unlocked node account", addressArg)
  .action(
    run(async (o: { arbiter: Address; admin?: Address; bondToken?: Address; account?: string; unlockedSender?: Address }) => {
      const { d } = ctx();
      const file = nw.deployNetwork({
        arbiter: o.arbiter,
        bondToken: o.bondToken ?? d.token,
        ...(o.admin ? { admin: o.admin } : {}),
        ...(o.account ? { account: o.account } : {}),
        ...(o.unlockedSender ? { unlockedSender: o.unlockedSender } : {}),
      });
      console.log(`Wrote ${file}. Next: \`tyrell network link\`.`);
    }),
  );
networkCmd
  .command("link [file]")
  .description("Point this deployment at the agents network (default: contracts/deployments/network-<chainId>.json)")
  .action(
    run(async (file?: string) => {
      const c = readConfig();
      const root = process.env.TYRELL_REPO ?? join(import.meta.dirname, "../../..");
      print(nw.linkNetwork(c, file ?? join(root, "contracts/deployments", `network-${c.chainId}.json`)));
    }),
  );
networkCmd.command("bond <agentId> <amount>").description("Post bond for an agent (token units)").option("--port <port>", "local port", "0").action(run(async (id: string, amt: string, o: { port: string }) => ownerSend(nw.bondTxs(ctx().d, ctx().d.token, BigInt(id), await tokenUnits(amt)), o.port)));
networkCmd
  .command("request-withdrawal <agentId> <amount>")
  .description("Step 1 of taking bond out: available one contest window later (keep the minimum or take it all)")
  .option("--port <port>", "local port", "0")
  .action(run(async (id: string, amt: string, o: { port: string }) => ownerSend([nw.requestWithdrawalTx(ctx().d, BigInt(id), await tokenUnits(amt))], o.port)));
networkCmd.command("withdraw <agentId>").description("Step 2: withdraw the requested bond (never with open reports)").option("--port <port>", "local port", "0").action(run(async (id: string, o: { port: string }) => ownerSend([nw.withdrawBondTx(ctx().d, BigInt(id))], o.port)));
networkCmd.command("cancel-withdrawal <agentId>").description("Keep the bond after all").option("--port <port>", "local port", "0").action(run(async (id: string, o: { port: string }) => ownerSend([nw.cancelWithdrawalTx(ctx().d, BigInt(id))], o.port)));
networkCmd
  .command("report <agentId>")
  .description("Report another human's agent, with evidence (posts the report bond)")
  .requiredOption("--evidence <ref>", "memory id, IPFS CID or URL of the evidence")
  .option("--category <n>", "1 payment manipulation, 2 impersonation, 3 spam, 4 non-delivery, 5 other", "1")
  .option("--port <port>", "local port", "0")
  .action(run(async (id: string, o: { evidence: string; category: string; port: string }) => ownerSend(nw.reportTxs(ctx().d, ctx().d.token, BigInt(id), Number(o.category), o.evidence), o.port)));
networkCmd.command("contest <reportId>").description("Contest a report against your agent (matches the report bond)").option("--port <port>", "local port", "0").action(run(async (id: string, o: { port: string }) => ownerSend(nw.contestTxs(ctx().d, ctx().d.token, BigInt(id)), o.port)));
networkCmd.command("finalize <reportId>").description("Close an uncontested report after the window (the reporter gets their bond back)").option("--port <port>", "local port", "0").action(run(async (id: string, o: { port: string }) => ownerSend([nw.finalizeTx(ctx().d, BigInt(id))], o.port)));
networkCmd.command("lapse <reportId>").description("Close a contested report the arbiter did not rule on in time").option("--port <port>", "local port", "0").action(run(async (id: string, o: { port: string }) => ownerSend([nw.lapseTx(ctx().d, BigInt(id))], o.port)));
networkCmd
  .command("resolve <reportId>")
  .description("Arbiter only: decide a contested report")
  .option("--uphold", "uphold (default: dismiss)")
  .option("--port <port>", "local port", "0")
  .action(run(async (id: string, o: { uphold?: boolean; port: string }) => ownerSend([nw.resolveTx(ctx().d, BigInt(id), !!o.uphold)], o.port)));
networkCmd
  .command("appeal <agentId>")
  .description("Ask the arbiter to lift your agent's ban")
  .requiredOption("--evidence <ref>", "IPFS CID or URL")
  .option("--port <port>", "local port", "0")
  .action(run(async (id: string, o: { evidence: string; port: string }) => ownerSend([nw.appealTx(ctx().d, BigInt(id), o.evidence)], o.port)));
networkCmd
  .command("unban <agentId>")
  .description("Arbiter only: lift a ban (an appeal granted)")
  .requiredOption("--reason <text>", "recorded on-chain")
  .option("--port <port>", "local port", "0")
  .action(run(async (id: string, o: { reason: string; port: string }) => ownerSend([nw.unbanTx(ctx().d, BigInt(id), o.reason)], o.port)));
networkCmd
  .command("set-arbiter <address>")
  .description("Network owner (council) only: replace the arbiter")
  .option("--port <port>", "local port", "0")
  .action(run(async (a: string, o: { port: string }) => ownerSend([nw.setArbiterTx(ctx().d, addressArg(a))], o.port)));
networkCmd
  .command("deal-open <fromAgent> <toAgent> <amount>")
  .description("Escrow a payment from your agent to another human's agent")
  .requiredOption("--terms <text>", "what is being bought; stored as a hash")
  .option("--days <n>", "deadline in days", "3")
  .option("--port <port>", "local port", "0")
  .action(
    run(async (from: string, to: string, amt: string, o: { terms: string; days: string; port: string }) => {
      const { d, pub } = ctx();
      const now = (await pub.getBlock()).timestamp;
      await ownerSend(nw.openDealTxs(d, d.token, BigInt(from), BigInt(to), await tokenUnits(amt), o.terms, now + BigInt(Number(o.days) * 86_400)), o.port);
    }),
  );
const DEAL_ACTIONS = { confirm: "confirmDeal", cancel: "cancelDeal", reclaim: "reclaim", deliver: "deliver", claim: "claim", dispute: "disputeDeal", lapse: "lapseDeal" } as const;
networkCmd
  .command("deal <action> <dealId>")
  .description(
    "payer: confirm | dispute (a delivered deal, within the contest window) | reclaim (after the deadline, if not delivered); payee: deliver | cancel | claim (delivered, payer silent past the window); anyone: lapse (a dispute the arbiter did not decide in time)",
  )
  .option("--port <port>", "local port", "0")
  .action(
    run(async (action: string, id: string, o: { port: string }) => {
      const fn = DEAL_ACTIONS[action as keyof typeof DEAL_ACTIONS];
      if (!fn) throw new InvalidArgumentError(`action: ${Object.keys(DEAL_ACTIONS).join(" | ")}`);
      await ownerSend([nw.dealTx(ctx().d, fn, BigInt(id))], o.port);
    }),
  );
networkCmd
  .command("resolve-deal <dealId>")
  .description("Arbiter only: decide a disputed deal")
  .option("--pay-payee", "release the escrow to the payee (default: refund the payer)")
  .option("--port <port>", "local port", "0")
  .action(run(async (id: string, o: { payPayee?: boolean; port: string }) => ownerSend([nw.resolveDealTx(ctx().d, BigInt(id), !!o.payPayee)], o.port)));
networkCmd
  .command("rep <agentId>")
  .description("An agent's reputation, record and bond")
  .action(
    run(async (id: string) => {
      const { d, pub } = ctx();
      if (!d.agentNetwork || !d.agentRegistry) throw new Error("this deployment is not linked to an agents network: run `tyrell network link`");
      const n = d.agentNetwork;
      const [[ok, code], reputation, bond, pending, record] = await Promise.all([
        pub.readContract({ address: d.agentRegistry, abi: agentRegistryAbi, functionName: "status", args: [BigInt(id)] }),
        pub.readContract({ address: n, abi: agentNetworkAbi, functionName: "reputation", args: [BigInt(id)] }),
        pub.readContract({ address: n, abi: agentNetworkAbi, functionName: "bondOf", args: [BigInt(id)] }),
        pub.readContract({ address: n, abi: agentNetworkAbi, functionName: "pendingWithdrawal", args: [BigInt(id)] }),
        pub.readContract({ address: n, abi: agentNetworkAbi, functionName: "record", args: [BigInt(id)] }),
      ]);
      print({ agentId: id, status: ok ? "active" : codeText(code), reputation, bond, pendingWithdrawal: { amount: pending[0], readyAt: pending[1] }, record });
    }),
  );
networkCmd
  .command("message <toAgent> <text>")
  .description("Sign a message to another agent with this deployment's agent key (prints JSON to send)")
  .option("--ttl <seconds>", "valid for", "3600")
  .action(
    run(async (to: string, text: string, o: { ttl: string }) => {
      const { d, pub } = ctx();
      if (d.agentId === undefined || !d.agentNetwork) throw new Error("this deployment is not a registered agent: run `tyrell agents register`");
      const now = (await pub.getBlock()).timestamp;
      const m = { fromAgent: d.agentId, toAgent: BigInt(to), bodyHash: messageBodyHash(text), nonce: BigInt(Date.now()), deadline: now + BigInt(o.ttl) };
      const signature = await signAgentMessage(account("steward", "agent"), d.chainId, d.agentNetwork, m);
      print({ ...m, body: text, signature });
    }),
  );
networkCmd
  .command("verify <json>")
  .description("Verify a received agent message on-chain (file path or inline JSON); --accept records it so it can't be replayed")
  .option("--accept", "record the message as accepted (owner transaction from the receiving agent's human)")
  .option("--port <port>", "local port", "0")
  .action(
    run(async (arg: string, o: { accept?: boolean; port: string }) => {
      const { d, pub } = ctx();
      if (!d.agentNetwork) throw new Error("this deployment is not linked to an agents network: run `tyrell network link`");
      const raw = JSON.parse(arg.trim().startsWith("{") ? arg : readFileSync(arg, "utf8")) as Record<string, string>;
      const m = {
        fromAgent: BigInt(raw.fromAgent!),
        toAgent: BigInt(raw.toAgent!),
        bodyHash: raw.body !== undefined ? messageBodyHash(raw.body) : (raw.bodyHash as Hex),
        nonce: BigInt(raw.nonce!),
        deadline: BigInt(raw.deadline!),
      };
      const signature = raw.signature as Hex;
      const [ok, code] = await pub.readContract({ address: d.agentNetwork, abi: agentNetworkAbi, functionName: "verifyMessage", args: [m.fromAgent, m.toAgent, m.bodyHash, m.nonce, m.deadline, signature] });
      print({ ok, ...(ok ? {} : { code: codeText(code) }), note: ok ? "trusted: a live, bonded agent bound to an accountable human signed this" : "do not trust this message" });
      if (ok && o.accept) await ownerSend([nw.acceptMessageTx(d, m, signature)], o.port);
    }),
  );

await program.parseAsync();
