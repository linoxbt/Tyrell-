import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodeFunctionData, erc20Abi, getAddress, keccak256, maxUint256, parseUnits, toBytes, type Address, type Hex, type PublicClient } from "viem";
import { AGENT_CODES, codeText, dealPayeeId, payeeIdOf, permMask, permNames, type PermName } from "@tyrell/core";
import { agentNetworkAbi, agentRegistryAbi, guardedVaultAbi, laneRegistryAbi, networks, testQieIdAbi, type Deployment } from "@tyrell/chain";
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
  label: string;
  model?: string;
  perms: number;
  perTx: bigint;
  daily: bigint;
  anyPayee: boolean;
}

export function registerTx(d: Deployment, i: RegisterInput): OwnerTx {
  return tx(
    `Register agent "${i.label}" (${permNames(i.perms).join(", ").toLowerCase() || "no permissions"})`,
    reg(d),
    encodeFunctionData({
      abi: agentRegistryAbi,
      functionName: "registerAgent",
      args: [i.key, i.label, i.model ? keccak256(toBytes(i.model)) : `0x${"0".repeat(64)}`, i.perms, i.perTx, i.daily, i.anyPayee],
    }),
  );
}

/** Link this deployment's vault: the registry may be charged by it, and it pays through payForAgent. */
export function spenderTxs(d: Deployment): OwnerTx[] {
  return [
    tx("Allow your vault to charge your agents", reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "setSpender", args: [d.guardedVault, true] })),
    tx("Point your vault at the agent registry", d.guardedVault, encodeFunctionData({ abi: guardedVaultAbi, functionName: "setAgentRegistry", args: [reg(d)] })),
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
export const freezeTx = (d: Deployment, frozen: boolean) =>
  tx(frozen ? "Freeze all of your agents" : "Unfreeze your agents", reg(d), encodeFunctionData({ abi: agentRegistryAbi, functionName: "freeze", args: [frozen] }));

const approveTx = (token: Address, spender: Address) => tx("Allow the agents network to take the bond token", token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] }));

export const bondTxs = (d: Deployment, token: Address, id: bigint, amount: bigint) => [
  approveTx(token, net(d)),
  tx(`Bond agent #${id}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "bond", args: [id, amount] })),
];
export const withdrawBondTx = (d: Deployment, id: bigint, amount: bigint) =>
  tx(`Withdraw bond of agent #${id}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "withdrawBond", args: [id, amount] }));
export const reportTxs = (d: Deployment, token: Address, id: bigint, category: number, evidence: string) => [
  approveTx(token, net(d)),
  tx(`Report agent #${id}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "fileReport", args: [id, category, keccak256(toBytes(evidence)), evidence] })),
];
export const contestTxs = (d: Deployment, token: Address, reportId: bigint) => [
  approveTx(token, net(d)),
  tx(`Contest report #${reportId}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "contest", args: [reportId] })),
];
export const finalizeTx = (d: Deployment, reportId: bigint) => tx(`Finalize report #${reportId}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "finalize", args: [reportId] }));
export const resolveTx = (d: Deployment, reportId: bigint, upheld: boolean) =>
  tx(`${upheld ? "Uphold" : "Dismiss"} report #${reportId} (arbiter)`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "resolve", args: [reportId, upheld] }));
export function openDealTxs(d: Deployment, token: Address, from: bigint, to: bigint, amount: bigint, terms: string, deadline: bigint): OwnerTx[] {
  return [
    approveTx(token, net(d)),
    tx(`Open a deal: agent #${from} pays agent #${to}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: "openDeal", args: [from, to, token, amount, keccak256(toBytes(terms)), deadline] })),
  ];
}
export const dealTx = (d: Deployment, action: "confirmDeal" | "cancelDeal" | "reclaim", dealId: bigint) =>
  tx(`${action === "confirmDeal" ? "Confirm" : action === "cancelDeal" ? "Cancel" : "Reclaim"} deal #${dealId}`, net(d), encodeFunctionData({ abi: agentNetworkAbi, functionName: action, args: [dealId] }));

/** The owner's agents, with live status, limits, today's spend, bond and reputation. */
export async function agentsReport(pub: PublicClient, d: Deployment) {
  const registry = reg(d);
  const human = await pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "human", args: [d.owner] });
  const bound = await pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "isBound", args: [d.owner] });
  const ids = await pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "agentsOf", args: [d.owner] });
  const quota = await pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "quota", args: [d.owner, d.token] });
  const spent = await pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "humanSpentToday", args: [d.owner, d.token] });
  const laneAgentKey = await pub.readContract({ address: d.laneRegistry, abi: laneRegistryAbi, functionName: "activeKey", args: [2] });
  const agents = [];
  for (const id of ids) {
    const a = await pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "agent", args: [id] });
    const [ok, code] = await pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "status", args: [id] });
    const today = await pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "spentToday", args: [id, d.token] });
    const extra = d.agentNetwork
      ? {
          bond: await pub.readContract({ address: d.agentNetwork, abi: agentNetworkAbi, functionName: "bondOf", args: [id] }),
          reputation: await pub.readContract({ address: d.agentNetwork, abi: agentNetworkAbi, functionName: "reputation", args: [id] }),
        }
      : {};
    agents.push({
      id,
      label: a.label,
      key: a.key,
      thisDeployment: a.key.toLowerCase() === laneAgentKey.toLowerCase(),
      status: ok ? "active" : `${codeText(code)}: ${AGENT_CODES[codeText(code)] ?? ""}`,
      permissions: permNames(a.permissions).map((p) => p.toLowerCase()),
      perTxLimit: a.perTxLimit,
      dailyLimit: a.dailyLimit,
      spentToday: today,
      anyPayee: a.anyPayee,
      ...extra,
    });
  }
  return { human: d.owner, qieId: human.qieId || null, bound, frozen: human.frozen, quotaToday: { quota, spent }, configuredAgentId: d.agentId ?? null, agents };
}

/** Deploy AgentRegistry + AgentNetwork once per chain with contracts/script/DeployNetwork.s.sol. */
export function deployNetwork(o: { bondToken: Address; arbiter: Address; account?: string; unlockedSender?: Address; qieId?: Address; repoRoot?: string; env?: Record<string, string> }): string {
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
  const env = { ...process.env, BOND_TOKEN: getAddress(o.bondToken), ARBITER: getAddress(o.arbiter), ...(o.qieId ? { QIE_ID: getAddress(o.qieId) } : {}), ...(o.env ?? {}) };
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
