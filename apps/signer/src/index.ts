import type { Server } from "node:net";
import { createWalletClient, http, recoverMessageAddress, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import type { LocalAccount } from "viem/accounts";
import { z } from "zod";
import { Lane, payRequestDigest, type Id16 } from "@tyrell/core";
import { guardedVaultAbi, laneRegistryAbi, type Deployment } from "@tyrell/chain";
import { serve } from "@tyrell/ipc";
import { chainFor } from "@tyrell/control";

export const PayRequestSchema = z
  .object({
    payeeId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    amount: z.string().regex(/^\d{1,78}$/),
    decisionId: z.string().regex(/^0x[0-9a-f]{32}$/),
    controlSig: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    agentId: z.string().regex(/^\d{1,78}$/).optional(),
  })
  .strict();
export type PayRequestMsg = z.infer<typeof PayRequestSchema>;

export class SignerRefused extends Error {}

export interface VaultSignerOptions {
  deployment: Deployment;
  client: PublicClient;
  /** The vault signer key: the only key this process holds (I-12). */
  key: LocalAccount;
  rpc: string;
}

/**
 * The signer process (spec section 4). Holds only the vault signer key and calls GuardedVault.pay for
 * one thing: a request signed by the active control lane key, for a call that simulates cleanly right
 * now, with a decision id never used before. It refuses everything else. Even if it is tricked, the
 * vault still pays only registered payees within caps (I-5).
 */
export class VaultSigner {
  private readonly wallet: WalletClient;
  private readonly seen = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: VaultSignerOptions) {
    this.wallet = createWalletClient({ account: o.key, chain: chainFor(o.deployment.chainId, o.rpc), transport: http(o.rpc) });
  }

  get address(): Address {
    return this.o.key.address;
  }

  handle(raw: unknown): Promise<{ txHash: Hex }> {
    const run = this.queue.then(() => this.pay(raw));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async pay(raw: unknown): Promise<{ txHash: Hex }> {
    const parsed = PayRequestSchema.safeParse(raw);
    if (!parsed.success) throw new SignerRefused("malformed pay request");
    const r = parsed.data;
    const d = this.o.deployment;
    const c = this.o.client;
    const req = {
      chainId: d.chainId,
      vault: d.guardedVault,
      payeeId: r.payeeId as Hex,
      token: r.token as Address,
      amount: BigInt(r.amount),
      decisionId: r.decisionId as Id16,
      ...(r.agentId !== undefined ? { agentId: BigInt(r.agentId) } : {}),
    };
    // a registered-agent deployment pays only for its own agent, and only through payForAgent
    if ((req.agentId ?? null) !== (d.agentRegistry ? (d.agentId ?? null) : null)) throw new SignerRefused("agent id does not match this deployment");

    // 1. Only control may ask: the request must be signed by the active control lane key.
    const from = await recoverMessageAddress({ message: { raw: payRequestDigest(req) }, signature: r.controlSig as Hex });
    const isControl = await c.readContract({ address: d.laneRegistry, abi: laneRegistryAbi, functionName: "isActiveFor", args: [from, Lane.Control] });
    if (!isControl) throw new SignerRefused(`request not signed by the active control key (got ${from})`);

    // 2. One payment per decision.
    if (this.seen.has(r.decisionId)) throw new SignerRefused("decision already paid");
    const used = await c.readContract({ address: d.guardedVault, abi: guardedVaultAbi, functionName: "decisionUsed", args: [req.decisionId] });
    if (used) throw new SignerRefused("decision already paid on-chain");

    // 3. The exact call must simulate cleanly now (the vault re-checks everything on-chain anyway).
    const base = { address: d.guardedVault, abi: guardedVaultAbi, account: this.o.key } as const;
    const agentId = req.agentId;
    try {
      if (agentId !== undefined) await c.simulateContract({ ...base, functionName: "payForAgent", args: [agentId, req.payeeId, req.token, req.amount, req.decisionId] });
      else await c.simulateContract({ ...base, functionName: "pay", args: [req.payeeId, req.token, req.amount, req.decisionId] });
    } catch (e) {
      throw new SignerRefused(`simulation failed: ${(e as Error).message.split("\n")[0]}`);
    }

    this.seen.add(r.decisionId);
    const txHash =
      agentId !== undefined
        ? await this.wallet.writeContract({ ...base, functionName: "payForAgent", args: [agentId, req.payeeId, req.token, req.amount, req.decisionId], chain: this.wallet.chain })
        : await this.wallet.writeContract({ ...base, functionName: "pay", args: [req.payeeId, req.token, req.amount, req.decisionId], chain: this.wallet.chain });
    const receipt = await c.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new SignerRefused(`pay transaction ${txHash} reverted`);
    return { txHash };
  }

  /** Serves pay requests on a Unix socket. */
  serve(path: string): Promise<Server> {
    return serve<PayRequestMsg>(path, (m) => this.handle(m), PayRequestSchema);
  }
}
