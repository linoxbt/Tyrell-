import { createPublicClient, createWalletClient, custom, getAddress, isAddress, isAddressEqual, keccak256, toBytes, toHex, zeroAddress, type Abi, type Address, type Hex, type PublicClient } from "viem";
import ARTIFACTS from "./playground/artifacts.json";
import type { Eip1193 } from "./wallet";

/*
 * A Tyrell account is a deployment: LaneRegistry, MemoryAnchor, TyrellLedger and GuardedVault on one chain,
 * owned by the human's wallet. The console reads it straight from the chain, creates one from the
 * wallet, and remembers the ones this browser has opened.
 */

export interface Deployment {
  chainId: number;
  startBlock: string;
  acct: Hex;
  owner: Address;
  laneRegistry: Address;
  memoryAnchor: Address;
  tyrellLedger: Address;
  guardedVault: Address;
  token: Address;
  testToken?: boolean;
  /** The keys that pay gas (anchoring memories, executing payments), when this browser created the account. */
  submitter?: Address;
  signer?: Address;
}

export const QUSDC_MAINNET: Address = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
export const LANES: Array<{ lane: number; name: "user" | "agent" | "wallet" | "control"; what: string; process: string }> = [
  { lane: 1, name: "user", what: "Your instructions and payee changes", process: "the tyrell CLI" },
  { lane: 2, name: "agent", what: "Steward, the AI agent", process: "Steward" },
  { lane: 3, name: "wallet", what: "What arrives in your wallet", process: "the ingest worker" },
  { lane: 4, name: "control", what: "Policy, quarantine and payment requests", process: "control" },
];

type Name = keyof typeof ARTIFACTS;
export const abi = (n: Name) => ARTIFACTS[n].abi as Abi;
const bytecode = (n: Name) => ARTIFACTS[n].bytecode as Hex;

/* ---------- remembered accounts ---------- */

const STORE = "tyrell.accounts.v1";
export function savedAccounts(): Deployment[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "[]") as Deployment[];
  } catch {
    return [];
  }
}
export function saveAccount(d: Deployment) {
  const all = savedAccounts().filter((x) => !(x.chainId === d.chainId && isAddressEqual(x.laneRegistry, d.laneRegistry)));
  localStorage.setItem(STORE, JSON.stringify([d, ...all]));
}
export function forgetAccount(d: Deployment) {
  localStorage.setItem(STORE, JSON.stringify(savedAccounts().filter((x) => !(x.chainId === d.chainId && isAddressEqual(x.laneRegistry, d.laneRegistry)))));
}

/** A deployment file, as `tyrell deploy` writes it (or the account file the console downloads). */
export function parseDeployment(text: string): Deployment {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("That is not a JSON file.");
  }
  const extra = (v.addresses ?? {}) as Record<string, unknown>;
  if (v.deployment && typeof v.deployment === "object") v = v.deployment as Record<string, unknown>;
  const opt = (k: string) => {
    const x = v[k] ?? extra[k];
    return typeof x === "string" && isAddress(x) ? { [k]: getAddress(x) } : {};
  };
  const a = (k: string) => {
    const x = v[k];
    if (typeof x !== "string" || !isAddress(x)) throw new Error(`The file has no valid "${k}" address.`);
    return getAddress(x);
  };
  const chainId = Number(v.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('The file has no "chainId".');
  return {
    chainId,
    startBlock: String(v.startBlock ?? "0"),
    acct: (typeof v.acct === "string" ? v.acct : "0x") as Hex,
    owner: a("owner"),
    laneRegistry: a("laneRegistry"),
    memoryAnchor: a("memoryAnchor"),
    tyrellLedger: a("tyrellLedger"),
    guardedVault: a("guardedVault"),
    token: a("token"),
    ...(v.testToken ? { testToken: true } : {}),
    ...opt("submitter"),
    ...opt("signer"),
  };
}

/* ---------- reading an account from the chain ---------- */

export interface Payee {
  payeeId: Hex;
  label: string;
  addr: Address;
  capPerTx: bigint;
  capPerDay: bigint;
  active: boolean;
  suspended: boolean;
}
export interface AccountState {
  owner: Address;
  keys: Record<number, Address>;
  payees: Payee[];
  memories: { total: number; byLane: Record<number, number>; recent: Array<{ id: Hex; lane: number; signer: Address; block: bigint }> };
  payments: Array<{ to: Address; amount: bigint; block: bigint; tx: Hex }>;
  activeSeeds: number;
  token: { symbol: string; decimals: number; vaultBalance: bigint };
  head: bigint;
  scannedFrom: bigint;
  gas: Array<{ name: "submitter" | "signer"; address: Address; balance: bigint }>;
}

const MAX_SCAN = 400_000n;

/** getLogs over a range, splitting it when the node refuses a range that large. */
async function logs(c: PublicClient, q: { address: Address; event: never; args?: never }, from: bigint, to: bigint): Promise<Array<{ args: Record<string, unknown>; blockNumber: bigint; transactionHash: Hex }>> {
  try {
    return (await c.getLogs({ ...q, fromBlock: from, toBlock: to })) as never;
  } catch (e) {
    if (to - from < 1_000n) throw e;
    const mid = from + (to - from) / 2n;
    return [...(await logs(c, q, from, mid)), ...(await logs(c, q, mid + 1n, to))];
  }
}
const event = (n: Name, name: string) => abi(n).find((x) => x.type === "event" && x.name === name) as never;

export async function readAccount(c: PublicClient, d: Deployment): Promise<AccountState> {
  const reg = { address: d.laneRegistry, abi: abi("LaneRegistry") } as const;
  const [owner, head, ...keys] = await Promise.all([
    c.readContract({ ...reg, functionName: "owner" }) as Promise<Address>,
    c.getBlockNumber(),
    ...LANES.map((l) => c.readContract({ ...reg, functionName: "activeKey", args: [l.lane] }) as Promise<Address>),
  ]);
  const start = BigInt(d.startBlock || "0");
  const from = head - start > MAX_SCAN ? head - MAX_SCAN : start;

  const [added, anchored, paid, seeds, symbol, decimals, vaultBalance] = await Promise.all([
    logs(c, { address: d.tyrellLedger, event: event("TyrellLedger", "PayeeAdded") }, from, head),
    logs(c, { address: d.memoryAnchor, event: event("MemoryAnchor", "MemoryAnchored") }, from, head),
    logs(c, { address: d.guardedVault, event: event("GuardedVault", "Paid") }, from, head),
    c.readContract({ address: d.tyrellLedger, abi: abi("TyrellLedger"), functionName: "activeSeeds" }) as Promise<readonly bigint[]>,
    c.readContract({ address: d.token, abi: abi("TyrellTestUSD"), functionName: "symbol" }).catch(() => "TOKEN") as Promise<string>,
    c.readContract({ address: d.token, abi: abi("TyrellTestUSD"), functionName: "decimals" }).catch(() => 6) as Promise<number>,
    c.readContract({ address: d.token, abi: abi("TyrellTestUSD"), functionName: "balanceOf", args: [d.guardedVault] }).catch(() => 0n) as Promise<bigint>,
  ]);

  const submitter = (await c.readContract({ address: d.memoryAnchor, abi: abi("MemoryAnchor"), functionName: "submitter" })) as Address;
  const gasKeys = [{ name: "submitter" as const, address: submitter }, ...(d.signer ? [{ name: "signer" as const, address: d.signer }] : [])];
  const gas = await Promise.all(gasKeys.map(async (k) => ({ ...k, balance: await c.getBalance({ address: k.address }) })));

  const ids = [...new Set(added.map((l) => l.args.payeeId as Hex))];
  const payees = await Promise.all(
    ids.map(async (payeeId) => {
      const p = (await c.readContract({ address: d.tyrellLedger, abi: abi("TyrellLedger"), functionName: "payee", args: [payeeId] })) as Omit<Payee, "payeeId">;
      return { payeeId, label: p.label, addr: p.addr, capPerTx: p.capPerTx, capPerDay: p.capPerDay, active: p.active, suspended: p.suspended };
    }),
  );

  const byLane: Record<number, number> = {};
  for (const l of anchored) byLane[Number(l.args.lane)] = (byLane[Number(l.args.lane)] ?? 0) + 1;
  return {
    owner,
    keys: Object.fromEntries(LANES.map((l, i) => [l.lane, keys[i]!])),
    payees,
    memories: {
      total: anchored.length,
      byLane,
      recent: anchored
        .slice(-12)
        .reverse()
        .map((l) => ({ id: l.args.id as Hex, lane: Number(l.args.lane), signer: l.args.signer as Address, block: l.blockNumber })),
    },
    payments: paid
      .slice(-12)
      .reverse()
      .map((l) => ({ to: l.args.to as Address, amount: l.args.amount as bigint, block: l.blockNumber, tx: l.transactionHash })),
    activeSeeds: seeds.length,
    token: { symbol, decimals, vaultBalance },
    head,
    scannedFrom: from,
    gas,
  };
}

/* ---------- writing: owner transactions from the connected wallet ---------- */

export function clients(provider: Eip1193, account: Address) {
  return {
    pub: createPublicClient({ transport: custom(provider), pollingInterval: 700 }) as PublicClient,
    wallet: createWalletClient({ account, transport: custom(provider) }),
  };
}

export async function ownerTx(provider: Eip1193, account: Address, to: Address, n: Name, functionName: string, args: readonly unknown[]) {
  const { pub, wallet } = clients(provider, account);
  const hash = await wallet.writeContract({ address: to, abi: abi(n), functionName, args, chain: null } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("The transaction failed on-chain.");
  return hash;
}

export interface NewAccountKeys {
  user: Address;
  agent: Address;
  wallet: Address;
  control: Address;
  submitter: Address;
  signer: Address;
}

export type Progress = (step: { i: number; label: string; state: "wait" | "done"; hash?: Hex }) => void;

export const CREATE_STEPS = (mainnet: boolean) => [
  "Create your key registry (LaneRegistry)",
  "Create your memory log (MemoryAnchor)",
  "Create your payee ledger (TyrellLedger)",
  "Create your vault (GuardedVault)",
  ...(mainnet ? [] : ["Create a test token for the vault"]),
  "Register the user key",
  "Register the agent key",
  "Register the wallet key",
  "Register the control key",
];

/**
 * Creates a Tyrell account from the connected wallet, in the order `tyrell deploy` uses: four contracts
 * (plus a test token off mainnet), then the four lane keys. Every step is a wallet transaction.
 */
export async function createAccount(provider: Eip1193, owner: Address, chainId: number, keys: NewAccountKeys, onStep: Progress): Promise<Deployment> {
  const { pub, wallet } = clients(provider, owner);
  const mainnet = chainId === 1990;
  const acct = keccak256(toBytes(`tyrell:${owner}:${chainId}:${toHex(crypto.getRandomValues(new Uint8Array(16)))}`));
  const startBlock = await pub.getBlockNumber();
  let i = 0;
  const deploy = async (n: Name, args: readonly unknown[]) => {
    const label = CREATE_STEPS(mainnet)[i]!;
    onStep({ i, label, state: "wait" });
    const hash = await wallet.deployContract({ abi: abi(n), bytecode: bytecode(n), args, chain: null } as never);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success" || !r.contractAddress) throw new Error(`${label}: the transaction failed.`);
    onStep({ i, label, state: "done", hash });
    i++;
    return getAddress(r.contractAddress);
  };
  const registry = await deploy("LaneRegistry", [owner]);
  const anchor = await deploy("MemoryAnchor", [owner, registry, acct, keys.submitter]);
  const ledger = await deploy("TyrellLedger", [registry]);
  const vault = await deploy("GuardedVault", [owner, ledger, keys.signer, keys.control]);
  const token = mainnet ? QUSDC_MAINNET : await deploy("TyrellTestUSD", [owner]);
  for (const l of LANES) {
    const label = CREATE_STEPS(mainnet)[i]!;
    onStep({ i, label, state: "wait" });
    const hash = await ownerTx(provider, owner, registry, "LaneRegistry", "addLaneKey", [l.lane, keys[l.name]]);
    onStep({ i, label, state: "done", hash });
    i++;
  }
  return { chainId, startBlock: startBlock.toString(), acct, owner, laneRegistry: registry, memoryAnchor: anchor, tyrellLedger: ledger, guardedVault: vault, token, ...(mainnet ? {} : { testToken: true }), submitter: keys.submitter, signer: keys.signer };
}

export const noKey = (a?: Address) => !a || isAddressEqual(a, zeroAddress);
