import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodeFunctionData, erc20Abi, getAddress, keccak256, maxUint256, parseUnits, toBytes, type Address, type Hex, type PublicClient } from "viem";
import { AGENT_CODES, codeText, dealPayeeId, payeeIdOf, permMask, permNames, type PermName } from "@tyrell/core";
import { agentNetworkAbi, agentRegistryAbi, guardedVaultAbi, laneRegistryAbi, memoryAnchorAbi, networks, testQieIdAbi, type Deployment } from "@tyrell/chain";
import type { OwnerTx } from "./setup.js";
import { readConfig, type TyrellConfig } from "./config.js";

/*
 * Agents network commands. Every write is an owner transaction sent from QIE Wallet through the local
 * owner page (the human signs; Tyrell's processes never hold the owner key). Builders here are pure so
 * they can be checked without a chain.
 */

export const parsePerms = (s: string): number => {
  const names = s
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  for (const n of names) if (!["PAY", "MEMORY", "MESSAGE", "DEAL"].includes(n)) throw new Error(`unknown permission "${n}" (pay, memory, message, deal)`);
  return permMask(names as PermName[]);
};

const tx = (label: string, to: Address, data: Hex): OwnerTx => ({ label, to, data });
const reg = (d: Deployment): Address => {
  if (!d.agentRegistry) throw new Error("this deployment is not linked to an agents network: run `tyrell network link`");
  return d.agentRegistry;
};
const net = (d: Deployment): Address => {
  if (!d.agentNetwork) throw new Error("this deployment is not linked to an agents network: run `tyrell network link`");
  return d.agentNetwork;
};

/** Bind the owner to a QIE ID. On a TestQieId chain the name is claimed first. */
export function bindTxs(d: Deployment, qieId: string, claimTestName: boolean): OwnerTx[] {
  const out: OwnerTx[] = [];
  if (claimTestName) out.push(tx(`Claim ${qieId} on the test QIE ID store`, d.qieId!, encodeFunctionData({ abi: testQieIdAbi, functionName: "claim", args: [qieId] })));
  out.push(tx(`Bind your account to ${qieId}`, reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "bindQieId", args: [qieId] })));
  return out;
}

export interface RegisterInput {
  key: Address;
  /** The one token the agent spends; its limits are in this token. */
  token: Address;
  label: string;
  model?: string;
  perms: number;
  perTx: bigint;
  daily: bigint;
  anyPayee: boolean;
  /** The agent key's consent: EIP-712 RegisterAgent(human = owner, key, deadline), see signAgentRegistration. */
  deadline: bigint;
  keySig: Hex;
}

export function registerTx(d: Deployment, i: RegisterInput): OwnerTx {
  return tx(
    `Register agent "${i.label}" (${permNames(i.perms).join(", ").toLowerCase() || "no permissions"})`,
    reg(d),
    encodeFunctionData({
      abi: agentRegistryAbi,
      functionName: "registerAgent",
      args: [
        {
          key: i.key,
          token: i.token,
          label: i.label,
          metaHash: i.model ? keccak256(toBytes(i.model)) : `0x${"0".repeat(64)}`,
          permissions: i.perms,
          perTxLimit: i.perTx,
          dailyLimit: i.daily,
          anyPayee: i.anyPayee,
        },
        i.deadline,
        i.keySig,
      ],
    }),
  );
}

/**
 * Link this deployment to its registered agent: the registry may be charged by the vault, the vault pays
 * through payForAgent only (its plain pay() closes), and agent-lane memories need the agent's MEMORY
 * permission. Register this deployment's agent first: with the vault linked, payments need its agent id.
 */
export function spenderTxs(d: Deployment): OwnerTx[] {
  if (d.agentId === undefined) throw new Error("register this deployment's agent first (`tyrell agents register`): once linked, the vault only pays through payForAgent");
  return [
    tx("Allow your vault to charge your agents", reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "setSpender", args: [d.guardedVault, true] })),
    tx("Point your vault at the agent registry (payments then go through payForAgent only)", d.guardedVault, encodeFunctionData({ abi: guardedVaultAbi, functionName: "setAgentRegistry", args: [reg(d)] })),
    tx(
      `Gate agent-lane memories on agent #${d.agentId} (it needs the memory permission)`,
      d.memoryAnchor,
      encodeFunctionData({ abi: memoryAnchorAbi, functionName: "linkAgent", args: [reg(d), d.agentId] }),
    ),
    ...(d.agentNetwork
      ? [tx("Allow the agents network to charge your agents for deals", reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "setSpender", args: [d.agentNetwork, true] }))]
      : []),
  ];
}

export const quotaTx = (d: Deployment, token: Address, daily: bigint) =>
  tx(`Set your daily quota shared by all agents`, reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "setQuota", args: [token, daily] }));
export const limitsTx = (d: Deployment, id: bigint, perTx: bigint, daily: bigint) =>
  tx(`Set agent #${id} limits`, reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "setLimits", args: [id, perTx, daily] }));
export const permsTx = (d: Deployment, id: bigint, perms: number) =>
  tx(`Set agent #${id} permissions`, reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "setPermissions", args: [id, perms] }));
export const payeesTx = (d: Deployment, id: bigint, labels: string[], allowed: boolean) =>
  tx(
    `${allowed ? "Delegate" : "Withdraw"} payees ${labels.join(", ")} ${allowed ? "to" : "from"} agent #${id}`,
    reg(d),
    encodeFunctionData({ abi: agentRegistryAbi, functionName: "setPayees", args: [id, labels.map((l) => (/^#\d+$/.test(l) ? dealPayeeId(BigInt(l.slice(1))) : payeeIdOf(l))), allowed] }),
  );
export const anyPayeeTx = (d: Deployment, id: bigint, on: boolean) =>
  tx(`Agent #${id} may pay ${on ? "any registered payee" : "only delegated payees"}`, reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "setAnyPayee", args: [id, on] }));
export const revokeAgentTx = (d: Deployment, id: bigint, reason: string) =>
  tx(`Revoke agent #${id} for good`, reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "revokeAgent", args: [id, reason] }));
export const rotateAgentKeyTx = (d: Deployment, id: bigint, newKey: Address, deadline: bigint, keySig: Hex) =>
  tx(`Replace agent #${id}'s key with ${newKey} (same agent, limits and record)`, reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "rotateAgentKey", args: [id, newKey, deadline, keySig] }));

/** Wait until agent `id`'s registered key is `key` (after a rotateAgentKey sent from the owner page). */
export async function waitAgentKey(pub: PublicClient, d: Deployment, id: bigint, key: Address, timeoutMs = Number(process.env.TYRELL_OWNER_TIMEOUT ?? 600) * 1000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const a = await pub.readContract({ address: reg(d), abi: agentRegistryAbi, functionName: "agent", args: [id] });
    if (a.key.toLowerCase() === key.toLowerCase()) return;
    if (Date.now() > until) throw new Error(`agent #${id}'s key is still ${a.key}, not ${key}: the rotation was not confirmed in time`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

export const freezeTx = (d: Deployment, frozen: boolean) =>
  tx(frozen ? "Freeze all of your agents" : "Unfreeze your agents", reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "freeze", args: [frozen] }));

const approveTx = (token: Address, spender: Address) => tx("Allow the agents network to take the bond token", token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] }));

export const bondTxs = (d: Deployment, token: Address, id: bigint, amount: bigint) => [
  approveTx(token, net(d)),
  tx(`Bond agent #${id}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "bond", args: [id, amount] })),
];
/** Bond withdrawal is two steps: request (the bond can still be slashed), then withdraw one contest window later. */
export const requestWithdrawalTx = (d: Deployment, id: bigint, amount: bigint) =>
  tx(`Ask to withdraw bond of agent #${id} (available after the contest window)`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "requestWithdrawal", args: [id, amount] }));
export const withdrawBondTx = (d: Deployment, id: bigint) =>
  tx(`Withdraw the requested bond of agent #${id}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "withdrawBond", args: [id] }));
export const cancelWithdrawalTx = (d: Deployment, id: bigint) =>
  tx(`Cancel the bond withdrawal of agent #${id}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "cancelWithdrawal", args: [id] }));
export const reportTxs = (d: Deployment, token: Address, id: bigint, category: number, evidence: string) => [
  approveTx(token, net(d)),
  tx(`Report agent #${id}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "fileReport", args: [id, category, keccak256(toBytes(evidence)), evidence] })),
];
export const contestTxs = (d: Deployment, token: Address, reportId: bigint) => [
  approveTx(token, net(d)),
  tx(`Contest report #${reportId}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "contest", args: [reportId] })),
];
export const finalizeTx = (d: Deployment, reportId: bigint) =>
  tx(`Close uncontested report #${reportId}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "finalize", args: [reportId] }));
export const lapseTx = (d: Deployment, reportId: bigint) =>
  tx(`Close report #${reportId}: the arbiter did not rule in time (both bonds refunded)`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "lapse", args: [reportId] }));
export const resolveTx = (d: Deployment, reportId: bigint, upheld: boolean) =>
  tx(`${upheld ? "Uphold" : "Dismiss"} report #${reportId} (arbiter)`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "resolve", args: [reportId, upheld] }));
export const appealTx = (d: Deployment, id: bigint, evidence: string) =>
  tx(`Appeal the ban of agent #${id}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "appeal", args: [id, evidence] }));
export const unbanTx = (d: Deployment, id: bigint, reason: string) =>
  tx(`Lift the ban of agent #${id} (arbiter)`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "unban", args: [id, reason] }));
export const setArbiterTx = (d: Deployment, arbiter: Address) =>
  tx(`Make ${arbiter} the arbiter (network owner)`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "setArbiter", args: [arbiter] }));
export const acceptMessageTx = (d: Deployment, m: { fromAgent: bigint; toAgent: bigint; bodyHash: Hex; nonce: bigint; deadline: bigint }, signature: Hex) =>
  tx(
    `Record message ${m.nonce} from agent #${m.fromAgent} as accepted (no replay)`,
    net(d),
    encodeFunctionData({ abi: agentNetworkAbi, functionName: "acceptMessage", args: [m.fromAgent, m.toAgent, m.bodyHash, m.nonce, m.deadline, signature] }),
  );
export function openDealTxs(d: Deployment, token: Address, from: bigint, to: bigint, amount: bigint, terms: string, deadline: bigint): OwnerTx[] {
  return [
    approveTx(token, net(d)),
    tx(`Open a deal: agent #${from} pays agent #${to}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "openDeal", args: [from, to, token, amount, keccak256(toBytes(terms)), deadline] })),
  ];
}
export type DealAction = "confirmDeal" | "cancelDeal" | "reclaim" | "deliver" | "claim" | "disputeDeal" | "lapseDeal";
const DEAL_VERB: Record<DealAction, string> = {
  confirmDeal: "Confirm",
  cancelDeal: "Cancel",
  reclaim: "Reclaim",
  deliver: "Mark delivered",
  claim: "Claim (the payer neither confirmed nor disputed)",
  disputeDeal: "Dispute",
  lapseDeal: "Refund (the arbiter did not decide in time)",
};
export const dealTx = (d: Deployment, action: DealAction, dealId: bigint) =>
  tx(`${DEAL_VERB[action]} deal #${dealId}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: action, args: [dealId] }));
export const resolveDealTx = (d: Deployment, dealId: bigint, payPayee: boolean) =>
  tx(`${payPayee ? "Pay the payee of" : "Refund the payer of"} disputed deal #${dealId} (arbiter)`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "resolveDeal", args: [dealId, payPayee] }));

/**
 * The owner's agents, with live status, limits, today's spend, bond and reputation. A fixed number of
 * reads (registry.agentsView, network.stats) however many agents the owner ever registered.
 */
export async function agentsReport(pub: PublicClient, d: Deployment) {
  const registry = reg(d);
  const [human, bound, rows, quota, spent, laneAgentKey] = await Promise.all([
    pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "human", args: [d.owner] }),
    pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "isBound", args: [d.owner] }),
    pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "agentsView", args: [d.owner] }),
    pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "quota", args: [d.owner, d.token] }),
    pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "humanSpentToday", args: [d.owner, d.token] }),
    pub.readContract({ address: d.laneRegistry, abi: laneRegistryAbi, functionName: "activeKey", args: [2] }),
  ]);
  const ids = rows.map((r) => r.id);
  // bond = what counts (effectiveBond); pendingWithdrawal = waiting to leave, still slashable
  const [bonds, pending, reps] = d.agentNetwork && ids.length ? await pub.readContract({ address: d.agentNetwork, abi: agentNetworkAbi, functionName: "stats", args: [ids] }) : [[], [], []];
  const agents = rows.map((r, i) => ({
    id: r.id,
    label: r.agent.label,
    key: r.agent.key,
    token: r.agent.token,
    thisDeployment: r.agent.key.toLowerCase() === laneAgentKey.toLowerCase(),
    status: r.ok ? "active" : `${codeText(r.code)}: ${AGENT_CODES[codeText(r.code)] ?? ""}`,
    permissions: permNames(r.agent.permissions).map((p) => p.toLowerCase()),
    perTxLimit: r.agent.perTxLimit,
    dailyLimit: r.agent.dailyLimit,
    spentToday: r.spentToday,
    anyPayee: r.agent.anyPayee,
    ...(d.agentNetwork ? { bond: bonds[i], ...(pending[i] ? { pendingWithdrawal: pending[i] } : {}), reputation: reps[i] } : {}),
  }));
  return { human: d.owner, qieId: human.qieId || null, bound, frozen: human.frozen, quotaToday: { quota, spent }, configuredAgentId: d.agentId ?? null, agents };
}

/** Deploy AgentRegistry + AgentNetwork once per chain with contracts/script/DeployNetwork.s.sol. */
export function deployNetwork(o: { bondToken: Address; arbiter: Address; admin?: Address; account?: string; unlockedSender?: Address; qieId?: Address; repoRoot?: string; env?: Record<string, string> }): string {
  const c = readConfig();
  const root = resolve(o.repoRoot ?? process.env.TYRELL_REPO ?? join(import.meta.dirname, "../../.."));
  const contracts = join(root, "contracts");
  const args = ["script", "script/DeployNetwork.s.sol", "--rpc-url", c.rpcs[0]!, "--broadcast"];
  if (o.unlockedSender) {
    if (c.network !== "local") throw new Error("--unlocked-sender is for local chains only");
    args.push("--unlocked", "--sender", o.unlockedSender);
  } else if (o.account) args.push("--account", o.account);
  else throw new Error("pass --account <foundry keystore name>");
  if (c.network !== "local" && c.network !== undefined) args.push("--verify", "--verifier", "blockscout", "--verifier-url", `${networks[c.network as "mainnet" | "testnet"].explorer}/api/`);
  const env = {
    ...process.env,
    BOND_TOKEN: getAddress(o.bondToken),
    ARBITER: getAddress(o.arbiter),
    ...(o.admin ? { ADMIN: getAddress(o.admin) } : {}),
    ...(o.qieId ? { QIE_ID: getAddress(o.qieId) } : {}),
    ...(o.env ?? {}),
  };
  const r = spawnSync(join(contracts, "node_modules/.bin/forge"), args, { cwd: contracts, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`forge script failed (exit ${r.status})`);
  const out = join(contracts, "deployments", `network-${c.chainId}.json`);
  if (!existsSync(out)) throw new Error(`forge did not write ${out}`);
  return out;
}

/** Record the network's addresses (and optionally this deployment's agent id) in the deployment file. */
export function linkNetwork(c: TyrellConfig, file: string, agentId?: bigint) {
  const deploymentFile = c.deploymentFile!;
  const dep = JSON.parse(readFileSync(deploymentFile, "utf8")) as Record<string, unknown>;
  if (file) {
    const n = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (Number(n.chainId) !== c.chainId) throw new Error(`network file is for chain ${String(n.chainId)}, this deployment is chain ${c.chainId}`);
    Object.assign(dep, { agentRegistry: n.agentRegistry, agentNetwork: n.agentNetwork, qieId: n.qieId, testQieId: n.testQieId });
  }
  if (agentId !== undefined) dep.agentId = agentId.toString();
  writeFileSync(deploymentFile, `${JSON.stringify(dep, null, 2)}\n`);
  return dep;
}

export const units = (s: string, decimals: number): bigint => parseUnits(s, decimals);

export interface WaitOptions {
  /** Give up after this long (default 10 minutes): a rejected or abandoned wallet prompt never lands. */
  timeoutMs?: number;
  pollMs?: number;
  log?: (s: string) => void;
}

/**
 * Wait for the owner's transactions, in order, from `fromBlock`: each is matched on-chain by sender, target
 * and calldata, and its receipt must succeed. Returns their hashes. Throws on the first revert, or when
 * the timeout passes (naming the transaction still missing), so a rejected wallet prompt never hangs.
 */
export async function waitForOwnerTxs(pub: PublicClient, owner: Address, txs: readonly OwnerTx[], fromBlock: bigint, o: WaitOptions = {}): Promise<Hex[]> {
  const timeoutMs = o.timeoutMs ?? 10 * 60_000;
  const pollMs = o.pollMs ?? 3_000;
  const until = Date.now() + timeoutMs;
  const hashes: Hex[] = [];
  let next = fromBlock;
  while (hashes.length < txs.length) {
    const head = await pub.getBlockNumber({ cacheTime: 0 });
    for (; next <= head && hashes.length < txs.length; next++) {
      const block = await pub.getBlock({ blockNumber: next, includeTransactions: true });
      for (const t of block.transactions) {
        const want = txs[hashes.length];
        if (!want) break;
        if (t.from.toLowerCase() !== owner.toLowerCase() || t.to?.toLowerCase() !== want.to.toLowerCase() || t.input.toLowerCase() !== want.data.toLowerCase()) continue;
        const r = await pub.getTransactionReceipt({ hash: t.hash });
        if (r.status !== "success") throw new Error(`"${want.label}" reverted (${t.hash}); nothing after it was applied`);
        hashes.push(t.hash);
        o.log?.(`  mined: ${want.label} (${t.hash})`);
      }
    }
    if (hashes.length === txs.length) break;
    if (Date.now() > until) {
      throw new Error(
        `gave up after ${Math.round(timeoutMs / 1000)} s waiting for "${txs[hashes.length]!.label}" (${hashes.length} of ${txs.length} mined). If the wallet rejected it, run the command again.`,
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return hashes;
}

/** After registering `key`, the id it got, checked to belong to `owner` (never someone else's agent). */
export async function registeredAgentId(pub: PublicClient, d: Deployment, key: Address): Promise<bigint> {
  const id = await pub.readContract({ address: reg(d), abi: agentRegistryAbi, functionName: "agentIdOf", args: [key] });
  if (id === 0n) throw new Error(`${key} is not a registered agent key`);
  const a = await pub.readContract({ address: reg(d), abi: agentRegistryAbi, functionName: "agent", args: [id] });
  if (a.human.toLowerCase() !== d.owner.toLowerCase()) throw new Error(`agent #${id} (key ${key}) belongs to ${a.human}, not to you (${d.owner}): not linking it`);
  return id;
}
