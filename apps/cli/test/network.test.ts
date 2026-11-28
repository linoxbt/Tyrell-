import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWalletClient, decodeFunctionData, encodeFunctionData, getAddress, hashTypedData, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PERM, REGISTER_AGENT_TYPES, ROTATE_AGENT_KEY_TYPES, agentRegistrationSigner, agentRegistryDomain, dealPayeeId, payeeIdOf, signAgentKeyRotation, signAgentRegistration } from "@tyrell/core";
import { agentNetworkAbi, agentRegistryAbi, laneRegistryAbi, memoryAnchorAbi, testQieIdAbi, type Deployment } from "@tyrell/chain";
import { agentsReport, bindTxs, dealTx, parsePerms, payeesTx, registerTx, registeredAgentId, requestWithdrawalTx, rotateAgentKeyTx, spenderTxs, openDealTxs, waitAgentKey, waitForOwnerTxs, withdrawBondTx } from "../src/network.js";
import { startAnvil, type BareAnvil } from "../../../test/support/anvil.js";

const a = (l: string) => getAddress(keccak256(toBytes(l)).slice(0, 42)) as Address;
const d = {
  chainId: 31337,
  owner: a("owner"),
  guardedVault: a("vault"),
  memoryAnchor: a("anchor"),
  token: a("token"),
  agentRegistry: a("registry"),
  agentNetwork: a("network"),
  qieId: a("qie"),
  agentId: 3n,
} as unknown as Deployment;
const SIG = `0x${"11".repeat(65)}` as Hex;

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
    const r = registerTx(d, { key: a("k"), token: d.token, label: "rent", perms: 9, perTx: 4n, daily: 5n, anyPayee: false, model: "gpt", deadline: 77n, keySig: SIG });
    expect(decodeFunctionData({ abi: agentRegistryAbi, data: r.data }).args).toEqual([
      { key: a("k"), token: d.token, label: "rent", metaHash: keccak256(toBytes("gpt")), permissions: 9, perTxLimit: 4n, dailyLimit: 5n, anyPayee: false },
      77n,
      SIG,
    ]);
    expect(r.label).toMatch(/pay, deal/);
  });

  it("delegates payees by label and agents by #id; links the vault; opens deals", () => {
    const t = payeesTx(d, 1n, ["landlord", "#7"], true);
    expect(decodeFunctionData({ abi: agentRegistryAbi, data: t.data }).args).toEqual([1n, [payeeIdOf("landlord"), dealPayeeId(7n)], true]);
    expect(spenderTxs(d).map((x) => x.to)).toEqual([d.agentRegistry, d.guardedVault, d.memoryAnchor, d.agentRegistry]);
    expect(decodeFunctionData({ abi: memoryAnchorAbi, data: spenderTxs(d)[2]!.data })).toMatchObject({ functionName: "linkAgent", args: [d.agentRegistry, 3n] });
    expect(spenderTxs({ ...d, agentNetwork: undefined } as Deployment)).toHaveLength(3);
    // linking the vault before this deployment is a registered agent would leave it unable to pay
    expect(() => spenderTxs({ ...d, agentId: undefined } as Deployment)).toThrow(/register this deployment's agent first/);
    expect(decodeFunctionData({ abi: agentNetworkAbi, data: requestWithdrawalTx(d, 1n, 5n).data })).toMatchObject({ functionName: "requestWithdrawal", args: [1n, 5n] });
    expect(decodeFunctionData({ abi: agentNetworkAbi, data: withdrawBondTx(d, 1n).data })).toMatchObject({ functionName: "withdrawBond", args: [1n] });
    expect(decodeFunctionData({ abi: agentNetworkAbi, data: dealTx(d, "deliver", 4n).data })).toMatchObject({ functionName: "deliver", args: [4n] });
    const deal = openDealTxs(d, d.token, 1n, 2n, 3n, "logo design", 100n);
    expect(deal[0]!.to).toBe(d.token); // approve first
    expect(decodeFunctionData({ abi: agentNetworkAbi, data: deal[1]!.data }).args).toEqual([1n, 2n, d.token, 3n, keccak256(toBytes("logo design")), 100n]);
    expect(() =>
      registerTx({ ...d, agentRegistry: undefined } as Deployment, { key: a("k"), token: d.token, label: "x", perms: 1, perTx: 1n, daily: 1n, anyPayee: true, deadline: 1n, keySig: SIG }),
    ).toThrow(/network link/);
  });

  it("signs the agent key's registration consent as the contract defines it", async () => {
    const key = privateKeyToAccount(keccak256(toBytes("consenting-agent")));
    const sig = await signAgentRegistration(key, 31337, d.agentRegistry!, d.owner, 99n);
    expect(await agentRegistrationSigner(31337, d.agentRegistry!, d.owner, key.address, 99n, sig)).toBe(key.address);
    // for another human the same signature names someone else
    expect(await agentRegistrationSigner(31337, d.agentRegistry!, a("bob"), key.address, 99n, sig)).not.toBe(key.address);
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
    expect(await chain.pub.readContract({ address: getAddress(n.agentNetwork!), abi: agentNetworkAbi, functionName: "owner" })).toBe(a("arbiter")); // ADMIN defaults to ARBITER off mainnet
    expect(await chain.pub.readContract({ address: getAddress(n.agentNetwork!), abi: agentNetworkAbi, functionName: "ruleWindow" })).toBe(7n * 86_400n);
    net = n;
  }, 120_000);

  let net: Record<string, string>;

  it("registers an agent with its key's consent, waits for receipts by hash, refuses reverts, and lists agents in a few reads", async () => {
    const registry = getAddress(net.agentRegistry!);
    const owner = chain.owner;
    const w = createWalletClient({ chain: chain.chain, transport: http(chain.url), account: owner });
    const dep = { ...d, owner, agentRegistry: registry, agentNetwork: getAddress(net.agentNetwork!), token: a("bond-token"), } as unknown as Deployment;
    const send = async (t: { to: Address; data: Hex }) => w.sendTransaction({ to: t.to, data: t.data, account: owner, chain: chain.chain });

    // the contract's digest is the one the TS helper signs
    const key = privateKeyToAccount(keccak256(toBytes("e2e-agent-key")));
    const head = await chain.pub.getBlock();
    const deadline = head.timestamp + 3_600n;
    const onchain = await chain.pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "registrationDigest", args: [owner, key.address, deadline] });
    expect(onchain).toBe(hashTypedData({ domain: agentRegistryDomain(31337, registry), types: REGISTER_AGENT_TYPES, primaryType: "RegisterAgent", message: { human: owner, key: key.address, deadline } }));

    const qie = getAddress(net.qieId!);
    const txs = [
      { label: "claim", to: qie, data: encodeFunctionData({ abi: testQieIdAbi, functionName: "claim", args: ["e2e.qie"] }) },
      { label: "bind", to: registry, data: encodeFunctionData({ abi: agentRegistryAbi, functionName: "bindQieId", args: ["e2e.qie"] }) },
      registerTx(dep, { key: key.address, token: a("bond-token"), label: "e2e", perms: PERM.PAY, perTx: 1n, daily: 1n, anyPayee: true, deadline, keySig: await signAgentRegistration(key, 31337, registry, owner, deadline) }),
    ];
    const from = await chain.pub.getBlockNumber();
    for (const t of txs) await send(t);
    const hashes = await waitForOwnerTxs(chain.pub, owner, txs, from, { pollMs: 50, timeoutMs: 20_000 });
    expect(hashes).toHaveLength(3);
    const id = await registeredAgentId(chain.pub, dep, key.address);
    expect(id).toBe(1n);
    // an id that belongs to someone else is never linked
    await expect(registeredAgentId(chain.pub, { ...dep, owner: a("someone-else") } as Deployment, key.address)).rejects.toThrow(/not to you/);
    await expect(registeredAgentId(chain.pub, dep, a("unknown-key"))).rejects.toThrow(/not a registered agent key/);

    // a reverting transaction (the same key again) is reported, not "Done"
    const again = registerTx(dep, { key: key.address, token: a("bond-token"), label: "e2e", perms: 1, perTx: 1n, daily: 1n, anyPayee: true, deadline, keySig: SIG });
    const from2 = await chain.pub.getBlockNumber();
    await w.sendTransaction({ to: again.to, data: again.data, account: owner, chain: chain.chain, gas: 500_000n });
    await expect(waitForOwnerTxs(chain.pub, owner, [again], from2, { pollMs: 50, timeoutMs: 20_000 })).rejects.toThrow(/reverted/);
    // a prompt the wallet never sent times out instead of hanging
    await expect(waitForOwnerTxs(chain.pub, owner, [{ label: "never sent", to: registry, data: "0x1234" }], from2, { pollMs: 50, timeoutMs: 300 })).rejects.toThrow(/gave up .* "never sent"/);

    // agents list: registry.agentsView + network.stats, against a LaneRegistry whose agent lane is this key
    const art = JSON.parse(readFileSync(join(__dirname, "../../../contracts/out/LaneRegistry.sol/LaneRegistry.json"), "utf8")) as { abi: typeof laneRegistryAbi; bytecode: { object: Hex } };
    const dh = await w.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [owner], account: owner, chain: chain.chain });
    const laneRegistry = (await chain.pub.waitForTransactionReceipt({ hash: dh })).contractAddress!;
    await chain.pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: laneRegistry, abi: laneRegistryAbi, functionName: "addLaneKey", args: [2, key.address], account: owner, chain: chain.chain }) });
    const report = await agentsReport(chain.pub, { ...dep, laneRegistry } as Deployment);
    expect(report.qieId).toBe("e2e.qie");
    expect(report.agents).toHaveLength(1);
    expect(report.agents[0]).toMatchObject({ id: 1n, key: key.address, thisDeployment: true, status: "active", permissions: ["pay"], bond: 0n, reputation: 500n });
    expect(report.agents[0]).not.toHaveProperty("pendingWithdrawal");

    // the agent's key is replaced in place with the new key's consent (as `tyrell agents rotate-key` does)
    const next = privateKeyToAccount(keccak256(toBytes("e2e-agent-key-2")));
    const onchainRot = await chain.pub.readContract({ address: registry, abi: agentRegistryAbi, functionName: "rotationDigest", args: [1n, owner, next.address, deadline] });
    expect(onchainRot).toBe(hashTypedData({ domain: agentRegistryDomain(31337, registry), types: ROTATE_AGENT_KEY_TYPES, primaryType: "RotateAgentKey", message: { agentId: 1n, human: owner, key: next.address, deadline } }));
    const rot = rotateAgentKeyTx(dep, 1n, next.address, deadline, await signAgentKeyRotation(next, 31337, registry, 1n, owner, deadline));
    const from3 = await chain.pub.getBlockNumber();
    await send(rot);
    await waitForOwnerTxs(chain.pub, owner, [rot], from3, { pollMs: 50, timeoutMs: 20_000 });
    await waitAgentKey(chain.pub, dep, 1n, next.address, 5_000);
    expect(await registeredAgentId(chain.pub, dep, next.address)).toBe(1n);
    await expect(registeredAgentId(chain.pub, dep, key.address)).rejects.toThrow(/not a registered agent key/);
    await expect(waitAgentKey(chain.pub, dep, 1n, key.address, 100)).rejects.toThrow(/not confirmed in time/);
  }, 120_000);
});
