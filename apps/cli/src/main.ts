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

const setup = program.command("setup").description("Generate keys and register them on-chain");
setup
  .command("keys")
  .description("Generate one encrypted keystore per role (user, agent, wallet, control, submitter, signer, data)")
  .option("--network <name>", "mainnet | testnet | local", "testnet")
  .option("--chain-id <id>", "override the chain id (local only)")
  .option("--store <kind>", "dir | pinata", "dir")
  .option("--gateway <url>", "Pinata dedicated gateway")
  .option("--new-passphrase", "create TYRELL_HOME/pass with a random passphrase if none exists")
  .action(
    run(async (o: { network: TyrellConfig["network"]; chainId?: string; store: string; gateway?: string; newPassphrase?: boolean }) => {
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
      console.log("Next: fund the submitter with a little QIEV3 for gas, then `tyrell deploy`.");
    }),
  );

setup
  .command("register")
  .description("Open a local page that registers the lane keys and the vault cap from QIE Wallet")
  .option("--daily-cap <units>", "vault-wide daily cap in token base units", "5000000")
  .option("--port <port>", "local port", "0")
  .action(
    run(async (o: { dailyCap: string; port: string }) => {
      const c = readConfig();
      const d = deployment(c);
      const pub = clients(c)[0]!;
      const addrs = JSON.parse(readFileSync(paths().addresses, "utf8")) as Record<string, Address>;
      const cap = BigInt(o.dailyCap);
      const txs = await pendingOwnerTxs(pub, d, addrs, cap);
      if (txs.length === 0) return void console.log("Everything is registered.");
      const html = ownerPageHtml({ chainId: c.chainId, chainName: c.network === "mainnet" ? "QIE Mainnet" : c.network === "testnet" ? "QIE Testnet" : "Local", rpcUrls: c.rpcs.slice(0, 2), owner: d.owner, txs });
      const { url, server } = await serveOwnerPage(html, Number(o.port));
      console.log(`Open ${url} in the browser that has QIE Wallet (owner ${d.owner}). ${txs.length} transaction(s):`);
      for (const t of txs) console.log(`  - ${t.label}`);
      for (;;) {
        await new Promise((r) => setTimeout(r, 4_000));
        if ((await pendingOwnerTxs(pub, d, addrs, cap)).length === 0) break;
      }
      server.close();
      console.log("Registered: four lane keys active and the vault cap set.");
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

await program.parseAsync();
