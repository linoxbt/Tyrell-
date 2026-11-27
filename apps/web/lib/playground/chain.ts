import { createEVM, type EVM } from "@ethereumjs/evm";
import { createCustomCommon, Hardfork, Mainnet } from "@ethereumjs/common";
import { bytesToHex, createAddressFromString, hexToBytes } from "@ethereumjs/util";
import { decodeErrorResult, decodeEventLog, decodeFunctionResult, encodeDeployData, encodeFunctionData, getAddress, type Abi, type AbiFunction, type Address, type Hex } from "viem";
import ARTIFACTS from "./artifacts.json";

/*
 * A real EVM (ethereumjs, Shanghai: the opcode set QIE runs) in the browser, loaded with Tyrell's compiled
 * contracts byte for byte. Calls can come from any address (no wallet, no keys needed to *send*); EIP-712
 * signatures are made with real keys and checked by the contracts. Time is controlled per call, so tests
 * can cross a UTC day or a contest window. Every step is recorded for the page to show.
 */

export type ContractName = keyof typeof ARTIFACTS;
export const abiOf = (n: ContractName) => ARTIFACTS[n].abi as Abi;

const ALL_ITEMS = Object.values(ARTIFACTS).flatMap((a) => a.abi as Abi);
const uniq = (items: Abi) => {
  const seen = new Set<string>();
  return items.filter((i) => {
    if (i.type !== "error" && i.type !== "event") return false;
    const key = `${i.type}:${i.name}:${JSON.stringify(i.inputs)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const ERRORS_AND_EVENTS = uniq(ALL_ITEMS);

export interface Step {
  kind: "deploy" | "send" | "read" | "revert" | "warp" | "sign" | "note" | "check";
  text: string;
  detail?: string;
  gas?: bigint;
}

export class Revert extends Error {
  constructor(
    readonly errorName: string,
    readonly args: readonly unknown[],
    readonly raw: Hex,
  ) {
    super(`${errorName}(${args.map(fmt).join(", ")})`);
  }
}

export const fmt = (v: unknown): string => {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") {
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) {
      // bytes32 codes like "OVER_CAP" are shown as text
      const bytes = hexToBytes(v as Hex);
      let end = bytes.length;
      while (end > 0 && bytes[end - 1] === 0) end--;
      const txt = new TextDecoder().decode(bytes.slice(0, end));
      if (end > 0 && end < 32 && /^[A-Z0-9_]+$/.test(txt)) return txt;
      return `${v.slice(0, 10)}…${v.slice(-6)}`;
    }
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) return `${v.slice(0, 6)}…${v.slice(-4)}`;
    if (/^0x[0-9a-fA-F]{32,}$/.test(v)) return `${v.slice(0, 10)}…${v.slice(-6)}`;
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(fmt).join(", ")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${k}: ${fmt(x)}`).join(", ")}}`;
  return String(v);
};

export class Chain {
  steps: Step[] = [];
  gasUsed = 0n;
  txs = 0;
  timestamp = 1_795_766_400n + 3_600n; // 2026-11-27 01:00 UTC
  number = 1n;
  names = new Map<string, string>(); // lowercase address -> label

  private constructor(
    private readonly evm: EVM,
    readonly chainId: number,
  ) {}

  static async create(chainId = 1990): Promise<Chain> {
    const common = createCustomCommon({ chainId }, Mainnet, { hardfork: Hardfork.Shanghai });
    return new Chain(await createEVM({ common }), chainId);
  }

  label(a: Address, name: string) {
    this.names.set(a.toLowerCase(), name);
    return a;
  }
  who = (a: string) => this.names.get(a.toLowerCase()) ?? `${a.slice(0, 6)}…${a.slice(-4)}`;

  private block() {
    return {
      header: {
        number: this.number,
        coinbase: createAddressFromString(`0x${"00".repeat(20)}`),
        timestamp: this.timestamp,
        difficulty: 0n,
        prevRandao: new Uint8Array(32),
        gasLimit: 30_000_000n,
        baseFeePerGas: 0n,
        getBlobGasPrice: () => undefined,
      },
    };
  }

  private async exec(from: Address, to: Address | undefined, data: Hex) {
    const r = await this.evm.runCall({
      caller: createAddressFromString(from),
      origin: createAddressFromString(from),
      ...(to ? { to: createAddressFromString(to) } : {}),
      data: hexToBytes(data),
      gasLimit: 30_000_000n,
      block: this.block() as never,
      skipBalance: true,
    });
    return r;
  }

  private decodeRevert(ret: Uint8Array): Revert {
    const raw = bytesToHex(ret) as Hex;
    try {
      const e = decodeErrorResult({ abi: ERRORS_AND_EVENTS, data: raw });
      return new Revert(e.errorName, (e.args ?? []) as unknown[], raw);
    } catch {
      return new Revert(raw === "0x" ? "revert" : "Error", [raw], raw);
    }
  }

  private events(logs: Array<[Uint8Array, Uint8Array[], Uint8Array]> | undefined) {
    return (logs ?? []).flatMap(([, topics, data]) => {
      try {
        const e = decodeEventLog({ abi: ERRORS_AND_EVENTS, data: bytesToHex(data) as Hex, topics: topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]] });
        return [{ name: e.eventName as string, args: e.args as Record<string, unknown> }];
      } catch {
        return [];
      }
    });
  }

  async deploy(name: ContractName, from: Address, args: readonly unknown[] = [], as?: string): Promise<Address> {
    const a = ARTIFACTS[name];
    const r = await this.exec(from, undefined, encodeDeployData({ abi: a.abi as Abi, bytecode: a.bytecode as Hex, args }));
    if (r.execResult.exceptionError) throw this.decodeRevert(r.execResult.returnValue);
    const addr = getAddress(r.createdAddress!.toString());
    this.label(addr, as ?? name);
    this.gasUsed += r.execResult.executionGasUsed;
    this.txs++;
    this.number++;
    this.steps.push({ kind: "deploy", text: `deploy ${name}${as && as !== name ? ` as ${as}` : ""}`, detail: addr, gas: r.execResult.executionGasUsed });
    return addr;
  }

  /** Send a transaction. Throws Revert (decoded custom error) if it reverts. */
  async send(from: Address, to: Address, name: ContractName, functionName: string, args: readonly unknown[] = []) {
    const data = encodeFunctionData({ abi: abiOf(name), functionName, args } as never);
    const r = await this.exec(from, to, data);
    const call = `${this.who(from)} → ${this.who(to)}.${functionName}(${args.map(fmt).join(", ")})`;
    if (r.execResult.exceptionError) {
      const e = this.decodeRevert(r.execResult.returnValue);
      this.steps.push({ kind: "revert", text: call, detail: `reverted: ${e.message}` });
      throw e;
    }
    const events = this.events(r.execResult.logs as never);
    this.gasUsed += r.execResult.executionGasUsed;
    this.txs++;
    this.number++;
    this.steps.push({ kind: "send", text: call, detail: events.length ? events.map((e) => `${e.name}(${Object.values(e.args).map(fmt).join(", ")})`).join(" · ") : undefined, gas: r.execResult.executionGasUsed });
    return { events, gas: r.execResult.executionGasUsed };
  }

  /** Send and require a specific custom error. Returns the decoded error args. */
  async expectRevert(from: Address, to: Address, name: ContractName, functionName: string, args: readonly unknown[], errorName: string, code?: string) {
    try {
      await this.send(from, to, name, functionName, args);
    } catch (e) {
      if (!(e instanceof Revert)) throw e;
      if (e.errorName !== errorName) throw new Error(`expected ${errorName}, got ${e.message}`);
      if (code !== undefined && fmt(e.args[0]) !== code) throw new Error(`expected ${errorName}(${code}), got ${e.message}`);
      this.steps[this.steps.length - 1]!.kind = "check";
      this.steps[this.steps.length - 1]!.detail = `refused as expected: ${e.message}`;
      return e.args;
    }
    throw new Error(`expected ${functionName} to revert with ${errorName}${code ? `(${code})` : ""}, but it succeeded`);
  }

  async read<T = unknown>(to: Address, name: ContractName, functionName: string, args: readonly unknown[] = []): Promise<T> {
    const abi = abiOf(name);
    const r = await this.exec(`0x${"00".repeat(19)}01` as Address, to, encodeFunctionData({ abi, functionName, args } as never));
    if (r.execResult.exceptionError) throw this.decodeRevert(r.execResult.returnValue);
    const fn = abi.find((x) => x.type === "function" && x.name === functionName) as AbiFunction;
    const out = decodeFunctionResult({ abi: [fn], functionName, data: bytesToHex(r.execResult.returnValue) as Hex }) as T;
    this.steps.push({ kind: "read", text: `${this.who(to)}.${functionName}(${args.map(fmt).join(", ")})`, detail: `→ ${fmt(out)}` });
    return out;
  }

  warp(seconds: bigint, why: string) {
    this.timestamp += seconds;
    this.number++;
    this.steps.push({ kind: "warp", text: `time +${seconds >= 86_400n ? `${Number(seconds) / 86_400} day(s)` : `${seconds}s`}`, detail: why });
  }

  note(text: string, detail?: string) {
    this.steps.push({ kind: "note", text, ...(detail ? { detail } : {}) });
  }

  check(ok: boolean, text: string, detail?: string) {
    this.steps.push({ kind: "check", text, ...(detail ? { detail } : {}) });
    if (!ok) throw new Error(`check failed: ${text}${detail ? ` (${detail})` : ""}`);
  }
}
