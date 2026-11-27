import { erc20Abi, type Address, type Hex } from "viem";
import type { Blob, Id16 } from "@tyrell/core";
import { call } from "@tyrell/ipc";
import { anchorDomain } from "@tyrell/control";
import { VaultSigner } from "@tyrell/signer";
import { OpenAICompatibleModel, Steward, type ControlApi, type DecisionMsg, type ProposalMsg, type TurnResult } from "@tyrell/steward";
import { account, checkKeyIsolation, clients, deployment, paths, readConfig } from "./config.js";
import { addPayee, McpQieIdResolver, reinstatePayee, releaseQuarantine, removePayee, type AddPayeeInput, type LedgerCtx } from "./payee.js";
import { readLedger } from "@tyrell/chain";

/** `tyrell signer start`: the signer process. Holds the vault signer key and nothing else. */
export async function startSigner(log: (s: string) => void = (s) => console.error(s)) {
  const foreign = checkKeyIsolation("signer");
  if (foreign.length) log(`warning: signer can read ${foreign.length} key file(s) of other roles (TYRELL_STRICT_KEYS=1 enforces isolation)`);
  const c = readConfig();
  const signer = new VaultSigner({ deployment: deployment(c), client: clients(c)[0]!, key: account("signer", "signer"), rpc: c.rpcs[0]! });
  const server = await signer.serve(paths().signerSocket);
  log(`signer ${signer.address}: listening on ${paths().signerSocket}`);
  return server;
}

/** Steward's view of control, over the control socket. */
export const ipcControl = (head: () => Promise<bigint>): ControlApi => ({
  recall: async (query, limit) => (await call(paths().socket, { type: "recall", query, ...(limit ? { limit } : {}) })) as Array<{ id: string; cls: string; body: string }>,
  submit: async (blob: Blob) => (await call(paths().socket, { type: "submit", blob: blob as never })) as { id: Id16; txHash: Hex },
  propose: async (proposal: ProposalMsg, readSet: Id16[], turn: Id16) => (await call(paths().socket, { type: "propose", proposal, readSet, turn })) as DecisionMsg,
  head,
});

/** `tyrell steward "<task>"`: one Steward turn in a process that holds only the agent key. */
export async function stewardTurn(task: string): Promise<TurnResult> {
  checkKeyIsolation("steward");
  const c = readConfig();
  const d = deployment(c);
  const pub = clients(c)[0]!;
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env;
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL) throw new Error("set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL (any OpenAI-compatible endpoint)");
  const [decimals, symbol] = await Promise.all([
    pub.readContract({ address: d.token, abi: erc20Abi, functionName: "decimals" }),
    pub.readContract({ address: d.token, abi: erc20Abi, functionName: "symbol" }),
  ]);
  const steward = new Steward({
    agentKey: account("steward", "agent"),
    acct: d.acct,
    domain: anchorDomain(d),
    control: ipcControl(() => pub.getBlockNumber({ cacheTime: 0 })),
    model: new OpenAICompatibleModel({ baseURL: LLM_BASE_URL, apiKey: LLM_API_KEY, model: LLM_MODEL }),
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
    ...(withResolver ? { resolver: new McpQieIdResolver() } : {}),
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
export const release = (seedId: bigint, reasonCid: string) => releaseQuarantine(ledgerCtx(false), seedId, reasonCid);

export async function payeeList() {
  const c = readConfig();
  const d = deployment(c);
  const pub = clients(c)[0]!;
  const head = await pub.getBlockNumber({ cacheTime: 0 });
  return (await readLedger(pub, d, head)).payees;
}
