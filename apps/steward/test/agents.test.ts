import { mkdtempSync, readFileSync } from "node:fs";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, getAddress, http, keccak256, parseEventLogs, toBytes, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { payeeIdOf, payRequestDigest, uuidv7, type Id16 } from "@tyrell/core";
import { agentRegistryAbi, guardedVaultAbi, testQieIdAbi, tyrellTestUSDAbi, type Deployment } from "@tyrell/chain";
import { serve, type Request } from "@tyrell/ipc";
import { importDataKey, MemoryBlobStore, newSecret, ProjectionDb } from "@tyrell/storage";
import { Control, Payments } from "@tyrell/control";
import { SignerRefused, VaultSigner } from "@tyrell/signer";
import { addPayee, type QieIdResolver } from "../../cli/src/payee.js";
import { startChainlab, type Chainlab } from "../../../test/support/anvil.js";

/*
 * Agents network, phase A, end to end through the real control process, policy engine, signer and
 * GuardedVault on anvil. This deployment is agent #1 of a human bound to alice.qie: its agent-lane key
 * is the registered agent key; a second agent of the same human shares the human's daily quota.
 */

const ROOT = join(__dirname, "../../..");
const art = (n: string) => JSON.parse(readFileSync(join(ROOT, `contracts/out/${n}.sol/${n}.json`), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
const addr = (label: string) => getAddress(keccak256(toBytes(label)).slice(0, 42)) as Address;
const LANDLORD = addr("landlord");
const LANDLORD_ID = payeeIdOf("landlord");

let lab: Chainlab;
let clients: PublicClient[];
let control: Control;
let payments: Payments;
let signer: VaultSigner;
let server: Server;
let socket: string;
let deployment: Deployment;
let registry: Address;
let qie: Address;
const store = new MemoryBlobStore();
const resolver: QieIdResolver = { resolve: async (n) => ({ "landlord.qie": LANDLORD })[n], reverse: async (a) => ({ [LANDLORD]: "landlord.qie" })[a] };

async function deploy(name: string, args: unknown[]): Promise<Address> {
  const a = art(name);
  const w = createWalletClient({ chain: lab.chain, transport: http(lab.url), account: lab.owner });
  const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, account: lab.owner, chain: lab.chain });
  return getAddress((await lab.pub.waitForTransactionReceipt({ hash })).contractAddress!);
}

const propose = (amount: bigint) =>
  payments.decide({ recipient: LANDLORD, amount: amount.toString(), token: deployment.token, payeeLabel: "landlord", reason: "rent" }, [], uuidv7() as Id16);

beforeAll(async () => {
  lab = await startChainlab();
  clients = [0, 1].map(() => createPublicClient({ chain: lab.chain, transport: http(lab.url), pollingInterval: 50 })) as PublicClient[];

  // the agents network: a test QIE ID store and the registry; the human (the vault owner) binds alice.qie
  qie = await deploy("TestQieId", []);
  registry = await deploy("AgentRegistry", [qie]);
  await lab.ownerWrite(qie, testQieIdAbi, "claim", ["alice.qie"]);
  await lab.ownerWrite(registry, agentRegistryAbi, "bindQieId", ["alice.qie"]);
  // agent #1 = this deployment's agent-lane key; agent #2 = another agent of the same human
  await lab.ownerWrite(registry, agentRegistryAbi, "registerAgent", [lab.lanes.agent.address, "rent agent", keccak256(toBytes("model")), 1, 4_000_000n, 10_000_000n, false]);
  await lab.ownerWrite(registry, agentRegistryAbi, "registerAgent", [addr("agent-2-key"), "bills agent", keccak256(toBytes("model")), 1, 4_000_000n, 5_000_000n, true]);
  await lab.ownerWrite(registry, agentRegistryAbi, "setPayees", [1n, [LANDLORD_ID], true]);
  await lab.ownerWrite(registry, agentRegistryAbi, "setQuota", [lab.deployment.token, 6_000_000n]);
  await lab.ownerWrite(registry, agentRegistryAbi, "setSpender", [lab.deployment.guardedVault, true]);
  await lab.ownerWrite(lab.deployment.guardedVault, guardedVaultAbi, "setAgentRegistry", [registry]);
  await lab.ownerWrite(lab.deployment.token, tyrellTestUSDAbi, "mint", [lab.deployment.guardedVault, 20_000_000n]);
  await lab.ownerWrite(lab.deployment.guardedVault, guardedVaultAbi, "setGlobalDailyCap", [lab.deployment.token, 20_000_000n]);

  deployment = { ...lab.deployment, agentRegistry: registry, qieId: qie, agentId: 1n };
  const dir = mkdtempSync(join(tmpdir(), "tyrell-agents-"));
  const db = new ProjectionDb(join(dir, "live.sqlite"));
  const dataKey = await importDataKey(newSecret());
  control = new Control({ deployment, clients, submitter: lab.lanes.submitter, rpc: lab.url, dataKey, store, db });
  await control.start();
  signer = new VaultSigner({ deployment, client: clients[0]!, key: lab.lanes.signer, rpc: lab.url });
  payments = new Payments({ control, clients, controlKey: lab.lanes.control, signerAddress: signer.address, signer: (r) => signer.handle(r) });
  socket = join(dir, "control.sock");
  server = await serve(socket, async (req: Request) => {
    if (req.type === "ledger") return control.relayLedger(req.action, req.message, req.signature as Hex);
    throw new Error(`unhandled ${req.type}`);
  });
  // the human registers the landlord (cap 5, daily 20) with the user key, through control
  await addPayee({ client: clients[0]!, deployment, user: lab.lanes.user, socket, resolver, log: () => undefined }, { label: "landlord", qieId: "landlord.qie", token: lab.deployment.token, cap: "5", daily: "20", confirm: LANDLORD.slice(-6) });
}, 180_000);

afterAll(() => {
  server?.close();
  lab?.stop();
});

describe("agents network phase A, end to end", () => {
  it("pays through GuardedVault.payForAgent and charges the agent and the human's quota", async () => {
    const d = await propose(3_000_000n);
    expect(d.verdict).toMatchObject({ decision: "ALLOW", code: "OK" });
    expect(d.txHash).toBeDefined();
    const receipt = await clients[0]!.getTransactionReceipt({ hash: d.txHash! });
    const events = parseEventLogs({ abi: guardedVaultAbi, logs: receipt.logs, eventName: "PaidForAgent" });
    expect(events).toHaveLength(1);
    expect(events[0]!.args.agentId).toBe(1n);
    expect(await clients[0]!.readContract({ address: registry, abi: agentRegistryAbi, functionName: "spentToday", args: [1n, deployment.token] })).toBe(3_000_000n);
  });

  it("blocks over the agent's per-payment limit with the registry's code (R4a)", async () => {
    const d = await propose(4_500_000n);
    expect(d.verdict.code).toBe("AGENT_BLOCKED");
    expect(d.verdict.reasons[0]).toBe("agent 1: OVER_AGENT_TX_LIMIT");
    expect(d.txHash).toBeUndefined();
  });

  it("shares one daily quota between the human's agents", async () => {
    // agent #2 (another deployment of the same human) spends 2 through the same vault
    const w = createWalletClient({ chain: lab.chain, transport: http(lab.url), account: lab.lanes.signer });
    const hash = await w.writeContract({ address: deployment.guardedVault, abi: guardedVaultAbi, functionName: "payForAgent", args: [2n, LANDLORD_ID, deployment.token, 1_000_000n, `0x${"ab".repeat(16)}`], chain: lab.chain });
    await clients[0]!.waitForTransactionReceipt({ hash });
    // the human has spent 3 + 1 = 4 of 6; agent #1 asking for 2.5 would make 6.5
    const d = await propose(2_500_000n);
    expect(d.verdict.reasons[0]).toBe("agent 1: OVER_HUMAN_QUOTA");
    expect((await propose(1_000_000n)).verdict.code).toBe("OK");
  });

  it("stops every agent the moment the human's QIE ID stops resolving to them", async () => {
    await lab.ownerWrite(qie, testQieIdAbi, "transferName", ["alice.qie", addr("new-holder")]);
    const d = await propose(500_000n);
    expect(d.verdict.reasons[0]).toBe("agent 1: HUMAN_UNBOUND");
    // and the vault refuses even a direct call from the signer key
    const w = createWalletClient({ chain: lab.chain, transport: http(lab.url), account: lab.lanes.signer });
    await expect(
      w.writeContract({ address: deployment.guardedVault, abi: guardedVaultAbi, functionName: "payForAgent", args: [1n, LANDLORD_ID, deployment.token, 1n, `0x${"cd".repeat(16)}`], chain: lab.chain }),
    ).rejects.toThrow(/AgentBlocked|HUMAN_UNBOUND|reverted/);
  });

  it("refuses an agent id whose registered key is not this deployment's agent-lane key", async () => {
    const other = new Payments({ control, clients, controlKey: lab.lanes.control, signerAddress: signer.address, signer: (r) => signer.handle(r) });
    (other as unknown as { o: { control: { deployment: Deployment } } }).o.control.deployment.agentId = 2n;
    try {
      const d = await other.decide({ recipient: LANDLORD, amount: "1", token: deployment.token, payeeLabel: "landlord" }, [], uuidv7() as Id16);
      expect(d.verdict.reasons[0]).toBe("agent 2: AGENT_KEY_MISMATCH");
    } finally {
      control.deployment.agentId = 1n;
    }
  });

  it("the signer refuses a control-signed request for a different agent", async () => {
    const req = { chainId: deployment.chainId, vault: deployment.guardedVault, payeeId: LANDLORD_ID, token: deployment.token, amount: 1n, decisionId: uuidv7() as Id16, agentId: 2n };
    const controlSig = await lab.lanes.control.signMessage({ message: { raw: payRequestDigest(req) } });
    await expect(signer.handle({ payeeId: req.payeeId, token: req.token, amount: "1", decisionId: req.decisionId, controlSig, agentId: "2" })).rejects.toBeInstanceOf(SignerRefused);
  });
});
