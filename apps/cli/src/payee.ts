import { createInterface } from "node:readline/promises";
import { erc20Abi, getAddress, isAddress, parseUnits, type Address, type Hex, type PublicClient } from "viem";
import type { LocalAccount } from "viem/accounts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ledgerTypedData, payeeIdOf, type LedgerAction } from "@tyrell/core";
import { tyrellLedgerAbi, type Deployment } from "@tyrell/chain";
import { call } from "@tyrell/ipc";

/** Resolves QIE IDs. Implemented by the QIE MCP server; faked in tests. */
export interface QieIdResolver {
  resolve(name: string): Promise<Address | undefined>;
  reverse(address: Address): Promise<string | undefined>;
  close?(): Promise<void>;
}

const normName = (n: string) => {
  const s = n.trim().toLowerCase();
  return s.endsWith(".qie") ? s : `${s}.qie`;
};

/** QIE ID resolution through the QIE MCP server (spec section 12): qie_resolve_name / qie_reverse_lookup. */
export class McpQieIdResolver implements QieIdResolver {
  private client?: Client;
  constructor(private readonly url = process.env.QIE_MCP_URL ?? "https://mcp.qie.digital/mcp") {}

  private async c(): Promise<Client> {
    if (!this.client) {
      this.client = new Client({ name: "tyrell-cli", version: "0.1.0" });
      await this.client.connect(new StreamableHTTPClientTransport(new URL(this.url)));
    }
    return this.client;
  }

  private async tool(name: string, args: Record<string, string>): Promise<Record<string, unknown>> {
    const r = await (await this.c()).callTool({ name, arguments: { ...args, network: "mainnet" } });
    const text = (r.content as Array<{ type: string; text?: string }>).find((x) => x.type === "text")?.text ?? "{}";
    return JSON.parse(text) as Record<string, unknown>;
  }

  async resolve(name: string): Promise<Address | undefined> {
    const r = await this.tool("qie_resolve_name", { name: normName(name) });
    return typeof r.address === "string" && isAddress(r.address) ? getAddress(r.address) : undefined;
  }

  async reverse(address: Address): Promise<string | undefined> {
    const r = await this.tool("qie_reverse_lookup", { address });
    return typeof r.name === "string" ? r.name : undefined;
  }

  async close(): Promise<void> {
    await this.client?.close();
  }
}

export class PayeeRejected extends Error {}

/**
 * Resolves a QIE ID once, here, at registration (spec section 9): the forward result must
 * reverse-resolve to the same name, or the payee is rejected before anything is signed (T-09).
 */
export async function resolvePayeeAddress(resolver: QieIdResolver, qieId: string): Promise<Address> {
  const name = normName(qieId);
  const addr = await resolver.resolve(name);
  if (!addr) throw new PayeeRejected(`${name} does not resolve to an address`);
  const back = await resolver.reverse(addr);
  if (!back || normName(back) !== name) throw new PayeeRejected(`${name} resolves to ${addr}, but ${addr} reverse-resolves to ${back ?? "nothing"}: not registering`);
  return addr;
}

export interface AddPayeeInput {
  label: string;
  qieId?: string;
  address?: Address;
  token: Address;
  /** Decimal amounts in token units, e.g. "5". */
  cap: string;
  daily: string;
  /** Last 6 hex characters of the address, typed by the human. Prompted for when absent and stdin is a TTY. */
  confirm?: string;
}

export interface LedgerCtx {
  client: PublicClient;
  deployment: Deployment;
  /** The user lane key: loaded only in the human CLI process (I-4). */
  user: LocalAccount;
  socket: string;
  resolver?: QieIdResolver;
  log?: (s: string) => void;
  /** Seconds the signature stays valid. */
  ttl?: number;
}

async function signAndRelay(ctx: LedgerCtx, action: LedgerAction, fields: Record<string, unknown>) {
  const last = await ctx.client.readContract({ address: ctx.deployment.tyrellLedger, abi: tyrellLedgerAbi, functionName: "lastNonce", args: [ctx.user.address] });
  const block = await ctx.client.getBlock({ blockTag: "latest" });
  const message = { ...fields, nonce: last + 1n, deadline: block.timestamp + BigInt(ctx.ttl ?? 3_600) };
  const typed = ledgerTypedData(action, message as never, { chainId: ctx.deployment.chainId, tyrellLedger: ctx.deployment.tyrellLedger });
  const signature = await ctx.user.signTypedData(typed as unknown as Parameters<LocalAccount["signTypedData"]>[0]);
  return (await call(ctx.socket, { type: "ledger", action: action as "AddPayee", message, signature })) as { txHash: Hex; block: bigint };
}

/**
 * `tyrell payee add`: the only way a payee is created (FR-07). Runs in the human CLI, signs with the
 * user key, and control merely relays the transaction. The model can suggest payees but never acts.
 */
export async function addPayee(ctx: LedgerCtx, i: AddPayeeInput) {
  const log = ctx.log ?? console.error;
  if (!/^[a-z0-9][a-z0-9 _.-]{0,63}$/i.test(i.label)) throw new PayeeRejected("label: 1-64 letters, digits, space, _ . -");
  let addr: Address;
  if (i.qieId) {
    if (!ctx.resolver) throw new PayeeRejected("no QIE ID resolver configured");
    log(`Resolving ${normName(i.qieId)} via the QIE MCP server ...`);
    addr = await resolvePayeeAddress(ctx.resolver, i.qieId);
    log(`  ${normName(i.qieId)} -> ${addr}, reverse lookup matches`);
  } else if (i.address && isAddress(i.address)) {
    addr = getAddress(i.address);
  } else {
    throw new PayeeRejected("pass --qie-id or --address");
  }

  const tail = addr.slice(-6).toLowerCase();
  let typed = i.confirm;
  if (typed === undefined && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    typed = await rl.question(`Confirm ${addr}: type the last 6 characters of the address: `);
    rl.close();
  }
  if (!typed || typed.trim().toLowerCase() !== tail) throw new PayeeRejected("confirmation does not match the address");

  const decimals = await ctx.client.readContract({ address: i.token, abi: erc20Abi, functionName: "decimals" });
  const capPerTx = parseUnits(i.cap, decimals);
  const capPerDay = parseUnits(i.daily, decimals);
  const payeeId = payeeIdOf(i.label);
  const r = await signAndRelay(ctx, "AddPayee", { payeeId, addr, token: getAddress(i.token), capPerTx, capPerDay, label: i.label });
  return { payeeId, addr, capPerTx, capPerDay, ...r };
}

export const removePayee = (ctx: LedgerCtx, label: string) => signAndRelay(ctx, "RemovePayee", { payeeId: payeeIdOf(label) });
export const reinstatePayee = (ctx: LedgerCtx, label: string) => signAndRelay(ctx, "ReinstatePayee", { payeeId: payeeIdOf(label) });
export const releaseQuarantine = (ctx: LedgerCtx, seedId: bigint, reasonCid: string) => signAndRelay(ctx, "ReleaseQuarantine", { seedId, reasonCid });
