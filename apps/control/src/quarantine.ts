import { keccak256, parseEventLogs, toBytes, createWalletClient, http, type Address, type Hex, type PublicClient } from "viem";
import type { LocalAccount } from "viem/accounts";
import {
  addressSeedValue,
  blastRadius,
  computeProjection,
  id16SeedValue,
  ledgerTypedData,
  SeedType,
  sourceSeedValue,
  type BlastRadius,
  type Id16,
  type Seed,
} from "@tyrell/core";
import { tyrellLedgerAbi } from "@tyrell/chain";
import { sealBlob, type BlobStore, type DataKey } from "@tyrell/storage";
import { chainFor, type Control } from "./control.js";

export type SeedSpec =
  | { type: "memory"; id: Id16 }
  | { type: "source"; ref: Address | Hex }
  | { type: "signer-window"; signer: Address; fromBlock: bigint; toBlock: bigint }
  | { type: "turn"; turn: Id16 };

export interface SeedValue {
  seedType: SeedType;
  seedValue: Hex;
  fromBlock: bigint;
  toBlock: bigint;
}

/** Encodes a seed the way TyrellLedger stores it. */
export function encodeSeed(s: SeedSpec): SeedValue {
  switch (s.type) {
    case "memory":
      return { seedType: SeedType.Memory, seedValue: id16SeedValue(s.id), fromBlock: 0n, toBlock: 0n };
    case "source":
      return { seedType: SeedType.Source, seedValue: sourceSeedValue(s.ref), fromBlock: 0n, toBlock: 0n };
    case "signer-window":
      return { seedType: SeedType.SignerWindow, seedValue: addressSeedValue(s.signer), fromBlock: s.fromBlock, toBlock: s.toBlock };
    case "turn":
      return { seedType: SeedType.Turn, seedValue: id16SeedValue(s.turn), fromBlock: 0n, toBlock: 0n };
  }
}

export interface QuarantineOptions {
  control: Control;
  clients: PublicClient[];
  /** The control lane key signs seeds; only the user key can release them (I-11). */
  controlKey: LocalAccount;
  /** Pays gas for the ledger transaction. */
  submitter: LocalAccount;
  rpc: string;
  store: BlobStore;
  dataKey: DataKey;
}

export interface Preview {
  memories: number;
  decisions: number;
  vaultTxs: number;
  radius: BlastRadius;
  /** Payees whose address is the seeded source: they will be suspended too. */
  payeesSuspended: Hex[];
}

const PREVIEW_ID = 0;

/**
 * Quarantine (spec section 10): excludes contaminated memories. The closure is computed from seeds at
 * projection time, so descendants written later are excluded too (I-8). Quarantine never removes keys
 * (I-9), never deletes or unpins anything (I-7), and is reversible only with the user key.
 */
export class Quarantine {
  constructor(private readonly o: QuarantineOptions) {}

  /** What a seed would reach, computed on the current projection without writing anything. */
  async preview(spec: SeedSpec): Promise<Preview> {
    const p = await this.o.control.refresh();
    const v = encodeSeed(spec);
    const hypothetical: Seed = { seedId: PREVIEW_ID, type: v.seedType, value: v.seedValue, fromBlock: v.fromBlock, toBlock: v.toBlock, released: false };
    const proj = computeProjection(p.results, [...p.snapshot.ledger.seeds, hypothetical]);
    const radius = blastRadius(PREVIEW_ID, proj);
    const payeesSuspended =
      v.seedType === SeedType.Source
        ? p.snapshot.ledger.payees.filter((x) => x.active && !x.suspended && addressSeedValue(x.addr) === v.seedValue.toLowerCase()).map((x) => x.payeeId)
        : [];
    return { memories: radius.memories.length, decisions: radius.decisions.length, vaultTxs: radius.vaultTxs.length, radius, payeesSuspended };
  }

  /**
   * Reads the control key's next ledger nonce, signs and sends, all inside control's single
   * transaction lane, so two quarantines at once can never sign the same nonce (B-4).
   */
  private signAndSend(functionName: "seedQuarantine" | "suspendPayee", build: (nonce: bigint) => { message: Record<string, unknown>; args: (sig: Hex) => readonly unknown[] }) {
    return this.o.control.exclusive(async () => {
      const { message, args } = build(await this.nextNonce());
      return this.signAndSendNow(functionName, message, args);
    });
  }

  private async signAndSendNow(functionName: "seedQuarantine" | "suspendPayee", message: Record<string, unknown>, args: (sig: Hex) => readonly unknown[]) {
    const d = this.o.control.deployment;
    const c = this.o.clients[0]!;
    const typed = ledgerTypedData(functionName === "seedQuarantine" ? "SeedQuarantine" : "SuspendPayee", message as never, { chainId: d.chainId, tyrellLedger: d.tyrellLedger });
    const sig = await this.o.controlKey.signTypedData(typed as unknown as Parameters<LocalAccount["signTypedData"]>[0]);
    const wallet = createWalletClient({ account: this.o.submitter, chain: chainFor(d.chainId, this.o.rpc), transport: http(this.o.rpc) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash = await wallet.writeContract({ address: d.tyrellLedger, abi: tyrellLedgerAbi, functionName, args: args(sig) as any, chain: wallet.chain, account: this.o.submitter });
    const receipt = await c.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} ${hash} reverted`);
    return receipt;
  }

  private async nextNonce(): Promise<bigint> {
    const d = this.o.control.deployment;
    return (await this.o.clients[0]!.readContract({ address: d.tyrellLedger, abi: tyrellLedgerAbi, functionName: "lastNonce", args: [this.o.controlKey.address] })) + 1n;
  }

  /**
   * Seeds a quarantine on TyrellLedger, signed by the control key. The reason and evidence are sealed
   * with the data key and pinned; only their CID goes on-chain. Payees at a seeded source address are
   * suspended (control may suspend, never add or reinstate).
   */
  async seed(spec: SeedSpec, reason: string, evidence: unknown = {}): Promise<{ seedId: number; txHash: Hex; reasonCid: string; preview: Preview; suspended: Hex[] }> {
    const preview = await this.preview(spec);
    const d = this.o.control.deployment;
    const doc = { reason, evidence, seed: spec, preview: { memories: preview.memories, decisions: preview.decisions, vaultTxs: preview.vaultTxs } };
    const docJson = JSON.stringify(doc, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
    const docId = keccak256(toBytes(docJson)).slice(0, 34) as Id16;
    const reasonCid = await this.o.store.put(await sealBlob(this.o.dataKey, d.acct, docId, JSON.parse(docJson)));

    const v = encodeSeed(spec);
    const block = await this.o.clients[0]!.getBlock({ blockTag: "latest" });
    const deadline = block.timestamp + 3_600n;
    const receipt = await this.signAndSend("seedQuarantine", (nonce) => ({
      message: { ...v, reasonCid, nonce, deadline },
      args: (sig) => [v.seedType, v.seedValue, v.fromBlock, v.toBlock, reasonCid, nonce, deadline, sig],
    }));
    const ev = parseEventLogs({ abi: tyrellLedgerAbi, eventName: "QuarantineSeeded", logs: receipt.logs })[0]!;
    const seedId = Number(ev.args.seedId);

    const suspended: Hex[] = [];
    for (const payeeId of preview.payeesSuspended) {
      await this.signAndSend("suspendPayee", (n) => ({ message: { payeeId, seedId: BigInt(seedId), nonce: n, deadline }, args: (sig) => [payeeId, BigInt(seedId), n, deadline, sig] }));
      suspended.push(payeeId);
    }
    await this.o.control.refresh();
    return { seedId, txHash: receipt.transactionHash, reasonCid, preview, suspended };
  }

  /** The active (unreleased) seed that already covers `spec`, if any. */
  async covering(spec: SeedSpec): Promise<number | undefined> {
    const p = this.o.control.projection ?? (await this.o.control.refresh());
    const v = encodeSeed(spec);
    return p.snapshot.ledger.seeds.find(
      (s) => !s.released && s.type === v.seedType && s.value.toLowerCase() === v.seedValue.toLowerCase() && s.fromBlock === v.fromBlock && s.toBlock === v.toBlock,
    )?.seedId;
  }

  /** The blast radius of an existing seed. */
  async blast(seedId: number): Promise<BlastRadius> {
    const p = await this.o.control.refresh();
    return blastRadius(seedId, p.projection);
  }
}
