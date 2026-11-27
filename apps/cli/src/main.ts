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
  .option("--mint <units>", "testnet only: fund the vault with TyrellTestUSD up to this many base units")
  .option("--port <port>", "local port", "0")
  .action(
    run(async (o: { dailyCap: string; port: string; mint?: string }) => {
      const c = readConfig();
      const d = deployment(c);
      const pub = clients(c)[0]!;
      const addrs = JSON.parse(readFileSync(paths().addresses, "utf8")) as Record<string, Address>;
      const cap = BigInt(o.dailyCap);
      const testToken = (JSON.parse(readFileSync(c.deploymentFile!, "utf8")) as { testToken?: boolean }).testToken === true;
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
  .description("Release a quarantine seed (user key)")
  .requiredOption("--reason <cid>", "IPFS CID of the reason")
  .action(run(async (seedId: string, o: { reason: string }) => print(await release(BigInt(seedId), o.reason))));

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
  .description("Print the blast radius of a seed")
  .option("--mermaid", "print a Mermaid graph instead of JSON")
  .action(
    run(async (seedId: string, o: { mermaid?: boolean }) => {
      const b = await blast(Number(seedId));
      if (o.mermaid) console.log(mermaid(b));
      else print(b);
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

await program.parseAsync();
