import { erc20Abi, type Address, type Hex } from "viem";
import type { Blob, Id16 } from "@tyrell/core";
import { llmFromEnv, signRequest } from "@tyrell/core";
import type { LocalAccount } from "viem/accounts";
import { call } from "@tyrell/ipc";
import { anchorDomain } from "@tyrell/control";
import { VaultSigner } from "@tyrell/signer";
import { OpenAICompatibleModel, Steward, type ControlApi, type DecisionMsg, type ProposalMsg, type TurnResult } from "@tyrell/steward";
import { account, checkKeyIsolation, clients, deployment, paths, readConfig } from "./config.js";
import { addPayee, McpQieIdResolver, qieIdNetwork, reinstatePayee, releaseQuarantine, removePayee, type AddPayeeInput, type LedgerCtx } from "./payee.js";
import { readLedger } from "@tyrell/chain";

/** `tyrell signer start`: the signer process. Holds the vault signer key and nothing else. */
export async function startSigner(log: (s: string) => void = (s) => console.error(s)) {
  const foreign = checkKeyIsolation("signer");
  if (foreign.length) log(`warning: signer can read ${foreign.length} key file(s) of other roles (allowed on a local chain only: on testnet and mainnet this aborts, and TYRELL_STRICT_KEYS=1 makes it abort here too)`);
  const c = readConfig();
  const signer = new VaultSigner({ deployment: deployment(c), client: clients(c)[0]!, key: account("signer", "signer"), rpc: c.rpcs[0]! });
  const server = await signer.serve(paths().signerSocket);
  log(`signer ${signer.address}: listening on ${paths().signerSocket}`);
  return server;
}

/**
 * Steward's view of control, over the control socket. Proposals are signed with the agent lane key,
 * so control acts only on what Steward itself proposed (S-6); recalls name the turn, so control can
 * make the decision cite everything it served that turn.
 */
export const ipcControl = (head: () => Promise<bigint>, agentKey: LocalAccount, acct: Hex): ControlApi => ({
  recall: async (query, limit, turn) =>
    (await call(paths().socket, { type: "recall", query, ...(limit ? { limit } : {}), ...(turn ? { turn } : {}) })) as Array<{ id: string; cls: string; body: string }>,
  submit: async (blob: Blob) => (await call(paths().socket, { type: "submit", blob: blob as never })) as { id: Id16; txHash: Hex },
  propose: async (proposal: ProposalMsg, readSet: Id16[], turn: Id16) =>
    (await call(paths().socket, await signRequest(agentKey, acct, { type: "propose", proposal: { ...proposal }, readSet, turn }), 300_000)) as DecisionMsg,
  head,
});

/** `tyrell steward "<task>"`: one Steward turn in a process that holds only the agent key. */
export async function stewardTurn(task: string): Promise<TurnResult> {
  checkKeyIsolation("steward");
  const c = readConfig();
  const d = deployment(c);
  const pub = clients(c)[0]!;
  const llm = llmFromEnv(process.env, "agent");
  if (!llm) throw new Error("set FORTYTWO_API_KEY (Fortytwo, Qwen), or LLM_BASE_URL, LLM_API_KEY and LLM_MODEL (any OpenAI-compatible endpoint)");
  const [decimals, symbol] = await Promise.all([
    pub.readContract({ address: d.token, abi: erc20Abi, functionName: "decimals" }),
    pub.readContract({ address: d.token, abi: erc20Abi, functionName: "symbol" }),
  ]);
  const agentKey = account("steward", "agent");
  const steward = new Steward({
    agentKey,
    acct: d.acct,
    domain: anchorDomain(d),
    control: ipcControl(() => pub.getBlockNumber({ cacheTime: 0 }), agentKey, d.acct),
    model: new OpenAICompatibleModel({ baseURL: llm.baseURL, apiKey: llm.apiKey, model: llm.model, ...(llm.reasoningEffort ? { reasoningEffort: llm.reasoningEffort } : {}) }),
    token: { address: d.token, decimals, aliases: [symbol, "QUSDC"] },
  });
  return steward.runTurn(task);
}

function ledgerCtx(withResolver: boolean): LedgerCtx {
  checkKeyIsolation("cli");
  const c = readConfig();
  return {
    client: clients(c)[0]!,
    deployment: deployment(c),
    user: account("cli", "user"),
    socket: paths().socket,
    ...(withResolver ? { resolver: new McpQieIdResolver(undefined, qieIdNetwork(c.network)) } : {}),
  };
}

export async function payeeAdd(i: Omit<AddPayeeInput, "token"> & { token?: Address }) {
  const ctx = ledgerCtx(!!i.qieId);
  try {
    return await addPayee(ctx, { ...i, token: i.token ?? ctx.deployment.token });
  } finally {
    await ctx.resolver?.close?.();
  }
}

export const payeeRemove = (label: string) => removePayee(ledgerCtx(false), label);
export const payeeReinstate = (label: string) => reinstatePayee(ledgerCtx(false), label);
/**
 * `tyrell release <seedId> --reason "<text>"`: the reason is written as a user-lane statement (sealed
 * with the data key and pinned by control, like any memory) and its CID goes on-chain with the
 * release. `--reason-cid` passes an existing CID instead.
 */
export async function release(seedId: bigint, o: { reason?: string; reasonCid?: string }) {
  let cid = o.reasonCid;
  let reasonMemory: Id16 | undefined;
  if (!cid) {
    if (!o.reason?.trim()) throw new Error("pass --reason <text> (or --reason-cid <cid>)");
    const { say } = await import("./commands.js");
    const a = await say(`Released quarantine seed ${seedId}: ${o.reason.trim()}`);
    cid = a.cid;
    reasonMemory = a.id;
  }
  const r = await releaseQuarantine(ledgerCtx(false), seedId, cid);
  return { ...(r as object), reasonCid: cid, ...(reasonMemory ? { reasonMemory } : {}) };
}

export async function payeeList() {
  const c = readConfig();
  const d = deployment(c);
  const pub = clients(c)[0]!;
  const head = await pub.getBlockNumber({ cacheTime: 0 });
  return (await readLedger(pub, d, head)).payees;
}
