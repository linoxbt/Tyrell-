import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEther,
  toBytes,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { guardedVaultAbi, laneRegistryAbi, memoryAnchorAbi, tyrellLedgerAbi, tyrellTestUSDAbi, type Deployment } from "@tyrell/chain";

const ROOT = join(__dirname, "../..");
const bin = (name: string) => join(ROOT, "contracts/node_modules/.bin", name);
const artifact = (name: string) => JSON.parse(readFileSync(join(ROOT, `contracts/out/${name}.sol/${name}.json`), "utf8")) as { bytecode: { object: Hex } };

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

/** Test keys from labels: no key-shaped literals in the repo. */
export const testKey = (label: string): Hex => keccak256(toBytes(`tyrell-e2e:${label}`));

export interface Lanes {
  user: PrivateKeyAccount;
  agent: PrivateKeyAccount;
  wallet: PrivateKeyAccount;
  control: PrivateKeyAccount;
  submitter: PrivateKeyAccount;
  signer: PrivateKeyAccount;
}

export interface Chainlab {
  url: string;
  chain: Chain;
  pub: PublicClient;
  owner: Address;
  lanes: Lanes;
  deployment: Deployment;
  ownerWrite: <F extends string>(address: Address, abi: readonly unknown[], functionName: F, args: readonly unknown[]) => Promise<Hex>;
  stop: () => void;
}

export interface BareAnvil {
  url: string;
  chain: Chain;
  pub: PublicClient;
  owner: Address;
  stop: () => void;
}

/** Starts an empty anvil chain (chain id 31337) with one unlocked, funded owner account. */
export async function startAnvil(): Promise<BareAnvil> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn(bin("anvil"), ["--port", String(port), "--chain-id", "31337", "--accounts", "2", "--silent"], { stdio: "ignore" });
  const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
  const pub = createPublicClient({ chain, transport: http(url), pollingInterval: 50 });
  for (let i = 0; ; i++) {
    try {
      await pub.getBlockNumber();
      break;
    } catch (e) {
      if (i > 100) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const [owner] = (await pub.request({ method: "eth_accounts" })) as Address[];
  return { url, chain, pub, owner: owner!, stop: () => proc.kill("SIGTERM") };
}

/** Starts anvil, deploys the five contracts from Foundry artifacts and registers the four lane keys. */
export async function startChainlab(): Promise<Chainlab> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn(bin("anvil"), ["--port", String(port), "--chain-id", "31337", "--accounts", "2", "--silent"], { stdio: "ignore" });
  const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
  const pub = createPublicClient({ chain, transport: http(url), pollingInterval: 50 });
  for (let i = 0; ; i++) {
    try {
      await pub.getBlockNumber();
      break;
    } catch (e) {
      if (i > 100) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const [owner] = (await pub.request({ method: "eth_accounts" })) as Address[];
  const ownerWallet = createWalletClient({ chain, transport: http(url), account: owner! });
  const test = createTestClient({ chain, mode: "anvil", transport: http(url) });

  const lanes: Lanes = {
    user: privateKeyToAccount(testKey("user")),
    agent: privateKeyToAccount(testKey("agent")),
    wallet: privateKeyToAccount(testKey("wallet")),
    control: privateKeyToAccount(testKey("control")),
    submitter: privateKeyToAccount(testKey("submitter")),
    signer: privateKeyToAccount(testKey("signer")),
  };
  await test.setBalance({ address: lanes.submitter.address, value: parseEther("10") });
  await test.setBalance({ address: lanes.signer.address, value: parseEther("1") });

  const wait = async (hash: Hex) => {
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`tx ${hash} reverted`);
    return r;
  };
  const deploy = async (name: string, abi: readonly unknown[], args: readonly unknown[]): Promise<Address> => {
    const hash = await ownerWallet.deployContract({ abi, bytecode: artifact(name).bytecode.object, args, account: owner!, chain });
    return (await wait(hash)).contractAddress!;
  };

  const acct = keccak256(toBytes("tyrell-e2e-account"));
  const startBlock = await pub.getBlockNumber();
  const laneRegistry = await deploy("LaneRegistry", laneRegistryAbi, [owner]);
  const memoryAnchor = await deploy("MemoryAnchor", memoryAnchorAbi, [owner, laneRegistry, acct, lanes.submitter.address]);
  const tyrellLedger = await deploy("TyrellLedger", tyrellLedgerAbi, [laneRegistry]);
  const guardedVault = await deploy("GuardedVault", guardedVaultAbi, [owner, tyrellLedger, lanes.signer.address, lanes.control.address]);
  const token = await deploy("TyrellTestUSD", tyrellTestUSDAbi, [owner]);

  const ownerWrite = async (address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash = await ownerWallet.writeContract({ address, abi: abi as any, functionName, args: args as any, account: owner!, chain });
    await wait(hash);
    return hash;
  };
  const laneIds: Array<[number, PrivateKeyAccount]> = [
    [1, lanes.user],
    [2, lanes.agent],
    [3, lanes.wallet],
    [4, lanes.control],
  ];
  for (const [lane, a] of laneIds) await ownerWrite(laneRegistry, laneRegistryAbi, "addLaneKey", [lane, a.address]);

  return {
    url,
    chain,
    pub,
    owner: owner!,
    lanes,
    deployment: { chainId: 31337, startBlock, acct, owner: owner!, laneRegistry, memoryAnchor, tyrellLedger, guardedVault, token },
    ownerWrite: ownerWrite as Chainlab["ownerWrite"],
    stop: () => proc.kill("SIGTERM"),
  };
}
