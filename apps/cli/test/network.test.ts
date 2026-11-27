import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, keccak256, toBytes, type Address } from "viem";
import { PERM, dealPayeeId, payeeIdOf } from "@tyrell/core";
import { agentNetworkAbi, agentRegistryAbi, type Deployment } from "@tyrell/chain";
import { bindTxs, parsePerms, payeesTx, registerTx, spenderTxs, openDealTxs } from "../src/network.js";
import { startAnvil, type BareAnvil } from "../../../test/support/anvil.js";

const a = (l: string) => getAddress(keccak256(toBytes(l)).slice(0, 42)) as Address;
const d = { chainId: 31337, owner: a("owner"), guardedVault: a("vault"), token: a("token"), agentRegistry: a("registry"), agentNetwork: a("network"), qieId: a("qie") } as unknown as Deployment;

describe("agents network CLI builders", () => {
  it("parses permissions", () => {
    expect(parsePerms("pay")).toBe(PERM.PAY);
    expect(parsePerms("Pay, deal,message")).toBe(PERM.PAY | PERM.DEAL | PERM.MESSAGE);
    expect(() => parsePerms("pay,admin")).toThrow(/unknown permission/);
  });

  it("binds (claiming on a test QIE ID store first) and registers", () => {
    const b = bindTxs(d, "alice.qie", true);
    expect(b.map((t) => t.to)).toEqual([d.qieId, d.agentRegistry]);
    expect(decodeFunctionData({ abi: agentRegistryAbi, data: b[1]!.data })).toMatchObject({ functionName: "bindQieId", args: ["alice.qie"] });
    expect(bindTxs(d, "alice.qie", false)).toHaveLength(1);
    const r = registerTx(d, { key: a("k"), label: "rent", perms: 9, perTx: 4n, daily: 5n, anyPayee: false, model: "gpt" });
    expect(decodeFunctionData({ abi: agentRegistryAbi, data: r.data }).args).toEqual([a("k"), "rent", keccak256(toBytes("gpt")), 9, 4n, 5n, false]);
    expect(r.label).toMatch(/pay, deal/);
  });

  it("delegates payees by label and agents by #id; links the vault; opens deals", () => {
    const t = payeesTx(d, 1n, ["landlord", "#7"], true);
    expect(decodeFunctionData({ abi: agentRegistryAbi, data: t.data }).args).toEqual([1n, [payeeIdOf("landlord"), dealPayeeId(7n)], true]);
    expect(spenderTxs(d).map((x) => x.to)).toEqual([d.agentRegistry, d.guardedVault, d.agentRegistry]);
    expect(spenderTxs({ ...d, agentNetwork: undefined } as Deployment)).toHaveLength(2);
    const deal = openDealTxs(d, d.token, 1n, 2n, 3n, "logo design", 100n);
    expect(deal[0]!.to).toBe(d.token); // approve first
    expect(decodeFunctionData({ abi: agentNetworkAbi, data: deal[1]!.data }).args).toEqual([1n, 2n, d.token, 3n, keccak256(toBytes("logo design")), 100n]);
    expect(() => registerTx({ ...d, agentRegistry: undefined } as Deployment, { key: a("k"), label: "x", perms: 1, perTx: 1n, daily: 1n, anyPayee: true })).toThrow(/network link/);
  });
});

describe("DeployNetwork.s.sol", () => {
  let chain: BareAnvil;
  beforeAll(async () => {
    chain = await startAnvil();
  }, 60_000);
  afterAll(() => chain?.stop());

  it("deploys a test QIE ID store, the registry and the network, linked, and writes network-31337.json", async () => {
    const contracts = join(__dirname, "../../../contracts");
    const r = spawnSync(join(contracts, "node_modules/.bin/forge"), ["script", "script/DeployNetwork.s.sol", "--rpc-url", chain.url, "--broadcast", "--unlocked", "--sender", chain.owner], {
      cwd: contracts,
      env: { ...process.env, BOND_TOKEN: a("bond-token"), ARBITER: a("arbiter") },
      encoding: "utf8",
    });
    expect(r.status, r.stderr || r.stdout).toBe(0);
    const n = JSON.parse(readFileSync(join(contracts, "deployments/network-31337.json"), "utf8")) as Record<string, string>;
    expect(n.testQieId).toBe(true);
    const registry = getAddress(n.agentRegistry!);
    expect(await chain.pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "network" })).toBe(getAddress(n.agentNetwork!));
    expect(await chain.pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "qieIdStore" })).toBe(getAddress(n.qieId!));
    expect(await chain.pub.readContract({ address: getAddress(n.agentNetwork!), abi: agentNetworkAbi, functionName: "arbiter" })).toBe(a("arbiter"));
    expect(await chain.pub.readContract({ address: getAddress(n.agentNetwork!), abi: agentNetworkAbi, functionName: "minBond" })).toBe(10_000_000n);
  }, 120_000);
});
