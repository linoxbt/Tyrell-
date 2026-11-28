import { getAddress, keccak256, pad, toBytes, toHex, type Address, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, type Blob, type Id16 } from "@tyrell/core";
import { TRANSFER_TOPIC0 } from "@tyrell/chain";
import { fetchMetadata } from "../src/metadata.js";
import { IngestWorker, truncateBytes, type Incident } from "../src/worker.js";


/*
 * The sentinel under hostile input (B-2, B-5, perf 4), with a fake RPC client: one malformed event
 * must not stop a scan, a Transfer with short data decodes as zero, identical dust is aggregated, a
 * scan has an event budget, bodies fit MAX_BODY_BYTES by bytes, and a blocklisted *sender* is the
 * address auto-quarantined (once), not the token.
 */

const VAULT = getAddress(keccak256(toBytes("vault")).slice(0, 42));
const addr = (s: string) => getAddress(keccak256(toBytes(s)).slice(0, 42));
const topic = (a: Address) => pad(a.toLowerCase() as Hex);
let li = 0;
const log = (token: Address, topics: Hex[], data: Hex, block = 10n) => ({
  address: token.toLowerCase(),
  topics,
  data,
  blockNumber: toHex(block),
  logIndex: toHex(li++),
  transactionIndex: "0x0",
  transactionHash: keccak256(toBytes(`tx${li}`)),
  blockHash: keccak256(toBytes("b")),
});

function fakeClient(logs: ReturnType<typeof log>[], names: Record<string, string> = {}): PublicClient {
  let served = false;
  return {
    request: async ({ method }: { method: string }) => {
      if (method !== "eth_getLogs") throw new Error(method);
      // the worker asks four topic filters per window; return everything once
      if (served) return [];
      served = true;
      return logs;
    },
    readContract: async ({ address, functionName }: { address: Address; functionName: string }) => {
      const n = names[address.toLowerCase()];
      if (functionName === "name" && n) return n;
      if (functionName === "symbol" && n) return "SYM";
      if (functionName === "decimals") return 6;
      throw new Error("no such function");
    },
  } as unknown as PublicClient;
}

function worker(client: PublicClient, o: { blocklist?: string[]; maxEvents?: number; mcp?: { balances(a: Address): Promise<string> } } = {}) {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const written: Blob[] = [];
  const incidents: Incident[] = [];
  const seeded: Address[] = [];
  let n = 0;
  const w = new IngestWorker({
    client,
    watch: [VAULT],
    walletKey: wallet,
    acct: keccak256(toBytes("acct")),
    domain: { chainId: 31337, memoryAnchor: addr("anchor") },
    control: {
      submitBatch: async (blobs) => {
        written.push(...blobs);
        return blobs.map(() => ({ id: `0x${(++n).toString(16).padStart(32, "0")}` as Id16 }));
      },
      incident: async (i) => void incidents.push(i),
      quarantineSource: async (a) => void seeded.push(a),
    },
    known: async () => [],
    dust: 1000n,
    threshold: 60,
    autoQuarantineBlocklist: true,
    ...(o.blocklist ? { blocklist: new Set(o.blocklist.map((x) => x.toLowerCase())) } : {}),
    ...(o.maxEvents ? { maxEvents: o.maxEvents } : {}),
    ...(o.mcp ? { mcp: o.mcp } : {}),
  });
  return { w, written, incidents, seeded };
}

describe("the sentinel survives hostile events", () => {
  it("a malformed event becomes an undecodable observation and the scan carries on", async () => {
    const good = addr("good");
    const bad = addr("bad");
    const sender = addr("sender");
    const logs = [
      log(bad, [TRANSFER_TOPIC0, `0x${"zz".repeat(32)}` as Hex, topic(VAULT)], "0x"),
      log(good, [TRANSFER_TOPIC0, topic(sender), topic(VAULT)], "0x01"), // short data: decodes as 0, no crash
    ];
    const { w, written } = worker(fakeClient(logs, { [good.toLowerCase()]: "Good Token" }));
    const r = await w.scan(1n, 20n);
    expect(r.observations).toHaveLength(2);
    expect(written[0]!.body).toMatch(/^Undecodable event from contract/);
    expect(written[1]!.body).toContain("transfer of 0 base units");
  });

  it("aggregates identical dust and keeps to the per-scan event budget", async () => {
    const spam = addr("spam");
    const from = addr("poisoner");
    const dust = log(spam, [TRANSFER_TOPIC0, topic(from), topic(VAULT)], toHex(1n, { size: 32 }));
    const many = Array.from({ length: 50 }, () => ({ ...dust, logIndex: toHex(li++), transactionHash: keccak256(toBytes(`spam${li}`)) }));
    const distinct = Array.from({ length: 5 }, (_, i) => log(addr(`t${i}`), [TRANSFER_TOPIC0, topic(addr(`f${i}`)), topic(VAULT)], toHex(5_000n, { size: 32 })));
    const { w, written } = worker(fakeClient([...many, ...distinct]), { maxEvents: 3 });
    await w.scan(1n, 20n);
    expect(written.filter((b) => b.body.includes("identical transfer"))).toHaveLength(1);
    expect(written.find((b) => b.body.includes("(and 49 identical transfer(s)"))).toBeDefined();
    expect(written.at(-1)!.body).toMatch(/^3 more transfer event\(s\) .* not read individually \(per-scan budget 3\)/);
    expect(written).toHaveLength(4);
  });

  it("auto-quarantines the blocklisted sender, once, not the token it sent", async () => {
    const token = addr("innocent token");
    const sender = addr("known scammer");
    const logs = [0, 1].map(() => log(token, [TRANSFER_TOPIC0, topic(sender), topic(VAULT)], toHex(10n, { size: 32 })));
    logs[1]!.transactionHash = keccak256(toBytes("second"));
    const { w, incidents, seeded } = worker(fakeClient(logs, { [token.toLowerCase()]: "Fine" }), { blocklist: [sender] });
    await w.scan(1n, 20n);
    expect(incidents.length).toBeGreaterThan(0);
    expect(incidents[0]!.source).toBe(sender);
    expect(seeded).toEqual([sender]);
  });

  it("FR-10: QIE MCP balance reads are written through the wallet lane as observations; MCP down is not fatal", async () => {
    const asked: Address[] = [];
    const ok = worker(fakeClient([]), { mcp: { balances: async (a) => (asked.push(a), `{"QIEV3":"1.5","tokens":[{"symbol":"QUSDC","balance":"12"}]}`) } });
    const r = await ok.w.scan(1n, 20n);
    expect(asked).toEqual([VAULT]);
    expect(r.observations).toHaveLength(1);
    expect(ok.written[0]!.body).toBe(`QIE MCP qie_get_balances(${VAULT}): {"QIEV3":"1.5","tokens":[{"symbol":"QUSDC","balance":"12"}]}`);
    expect(ok.written[0]!.header.src).toEqual([{ t: "mcp", tool: "qie_get_balances", args: { address: VAULT } }]);
    expect(ok.written[0]!.header.lane).toBe(3);
    const down = worker(fakeClient([]), { mcp: { balances: async () => Promise.reject(new Error("503")) } });
    expect(await down.w.scan(1n, 20n)).toEqual({ observations: [], incidents: [] });
  });

  it("truncates bodies by bytes, not characters", () => {
    const s = "é".repeat(6000); // 12,000 bytes
    const t = truncateBytes(s, MAX_BODY_BYTES - 192);
    expect(Buffer.byteLength(t, "utf8")).toBeLessThanOrEqual(MAX_BODY_BYTES - 192);
    expect(t.endsWith("...")).toBe(true);
    expect(truncateBytes("short", 100)).toBe("short");
  });

  it("a data: URI with a broken percent-escape is read as raw text", async () => {
    const r = await fetchMetadata('data:application/json,{"name":"100%"}');
    expect(r).toEqual({ ok: true, text: '{"name":"100%"}' });
  });
});
