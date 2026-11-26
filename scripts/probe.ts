/**
 * Phase 0 probe (spec section 16). Resolves every "Verify" item against the real QIE network
 * and writes PROBE.md. Read-only: it sends no transactions and needs no private key.
 *
 *   pnpm probe                      # both networks
 *   pnpm probe -- --network mainnet # one network
 *
 * Optional env: PINATA_JWT, PINATA_GATEWAY (P-10), PROBE_QIE_ID (P-6), QIE_MCP_URL.
 */
import { writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { performance } from "node:perf_hooks";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, hexToBigInt, type Hex } from "viem";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { networks, QUSDC_MAINNET, TRANSFER_TOPIC0, type NetworkName } from "@tyrell/chain";

type Status = "PASS" | "PARTIAL" | "FALLBACK" | "FAIL" | "SKIP" | "MANUAL";
interface Result {
  id: string;
  name: string;
  network: NetworkName | "-";
  status: Status;
  summary: string;
  details: string[];
}

const results: Result[] = [];
const decisions: string[] = [];
const MCP_URL = process.env.QIE_MCP_URL ?? "https://mcp.qie.digital/mcp";
const ZERO = "0x0000000000000000000000000000000000000000";
// EIP-1967 implementation slot: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
const EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"; // key-scan: allow

// ---------- JSON-RPC ----------

interface RpcOut<T> { ok: boolean; result?: T; error?: string; ms: number; transport?: boolean; url?: string }

async function rpc<T = unknown>(url: string, method: string, params: unknown[] = [], timeoutMs = 8000): Promise<RpcOut<T>> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = performance.now() - t0;
    const text = await res.text();
    let body: { result?: T; error?: { code?: number; message?: string } };
    try { body = JSON.parse(text); } catch { return { ok: false, error: `HTTP ${res.status}, non-JSON body: ${text.slice(0, 120)}`, ms, transport: true }; }
    if (body.error) return { ok: false, error: `${body.error.code ?? ""} ${body.error.message ?? JSON.stringify(body.error)}`.trim(), ms };
    if (!("result" in body)) return { ok: false, error: `HTTP ${res.status}, no result`, ms, transport: true };
    return { ok: true, result: body.result as T, ms };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: performance.now() - t0, transport: true };
  }
}

/** Endpoint drops seen during the run, per network (evidence for R0's two-endpoint rule). */
const drops: Partial<Record<NetworkName, Set<string>>> = {};

/**
 * Same as rpc() but fails over to the next healthy endpoint when one stops answering, so a flaky
 * endpoint is reported as a drop instead of being mistaken for a missing feature.
 */
async function rpcAny<T = unknown>(net: NetworkName, eps: Endpoint[], method: string, params: unknown[] = [], timeoutMs = 8000): Promise<RpcOut<T>> {
  let last: RpcOut<T> = { ok: false, error: "no endpoints", ms: 0, transport: true };
  const pool = eps.some((e) => e.full) ? eps.filter((e) => e.full) : eps;
  for (const ep of pool) {
    last = { ...(await rpc<T>(ep.url, method, params, timeoutMs)), url: ep.url };
    if (!last.transport) return last;
    (drops[net] ??= new Set()).add(ep.url);
  }
  return last;
}

const hexNum = (h: string) => Number(hexToBigInt(h as Hex));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? NaN; };
const fmtMs = (ms: number) => `${Math.round(ms)} ms`;
const short = (s: string, n = 140) => (s.length > n ? s.slice(0, n) + "…" : s);

function record(r: Result) {
  results.push(r);
  console.log(`${r.status.padEnd(8)} ${r.id.padEnd(5)} ${r.network.padEnd(8)} ${r.summary}`);
}

// ---------- P-1: endpoints ----------

/** full = a real node (answers eth_feeHistory and eth_estimateGas); false = a partial proxy such as Blockscout's /api/eth-rpc. */
interface Endpoint { url: string; latencyMs: number; head: number; full: boolean }

async function p1(net: NetworkName): Promise<Endpoint[]> {
  const { chain, rpcs: fullRpcs, logRpc } = networks[net];
  const rpcs = [...fullRpcs, logRpc];
  const want = `0x${chain.id.toString(16)}`;
  const details: string[] = [];
  const healthy: Endpoint[] = [];
  await Promise.all(rpcs.map(async (url) => {
    const id = await rpc<string>(url, "eth_chainId");
    if (!id.ok) { details.push(`${url}: no answer (${short(id.error ?? "")})`); return; }
    if (id.result !== want) { details.push(`${url}: wrong chain ${id.result}, expected ${want}`); return; }
    const samples: number[] = [];
    let head = 0;
    for (let i = 0; i < 3; i++) {
      const bn = await rpc<string>(url, "eth_blockNumber");
      if (bn.ok && bn.result) { samples.push(bn.ms); head = hexNum(bn.result); }
    }
    if (!samples.length) { details.push(`${url}: chainId ok but eth_blockNumber failed`); return; }
    const latencyMs = median(samples);
    const fh = await rpc(url, "eth_feeHistory", ["0x1", "latest", []]);
    const eg = await rpc(url, "eth_estimateGas", [{ from: ZERO, to: ZERO, data: "0x" }]);
    const full = fh.ok && eg.ok;
    healthy.push({ url, latencyMs, head, full });
    details.push(`${url}: ${want}, head ${head}, median ${fmtMs(latencyMs)} (first call incl. TLS ${fmtMs(id.ms)}); ${full ? "full node" : `PARTIAL method set (eth_feeHistory: ${fh.ok ? "ok" : short(fh.error ?? "", 40)}; eth_estimateGas: ${eg.ok ? "ok" : short(eg.error ?? "", 40)})`}`);
  }));
  healthy.sort((a, b) => Number(b.full) - Number(a.full) || a.latencyMs - b.latencyMs);
  details.sort();
  const fast = healthy.filter((e) => e.latencyMs < 1000).length;
  if (healthy.length) {
    const heads = healthy.map((e) => e.head);
    details.push(`Head spread across healthy endpoints: ${Math.max(...heads) - Math.min(...heads)} blocks`);
  }
  details.push("Latency is measured from this machine through an HTTPS proxy, so it overstates what a VPS near QIE would see.");
  const fullEps = healthy.filter((e) => e.full);
  const partial = healthy.filter((e) => !e.full);
  const status: Status = healthy.length === rpcs.length && fast >= 3 ? "PASS" : fullEps.length >= 2 ? "FALLBACK" : "FAIL";
  record({
    id: "P-1", name: "eth_chainId on every RPC", network: net, status,
    summary: `${healthy.length}/${rpcs.length} endpoints answer ${want}; ${fast} under 1 s; ${fullEps.length} full nodes`,
    details,
  });
  if (fullEps.length >= 2) decisions.push(`${net}: full-node RPCs ${fullEps.map((e) => e.url).join(", ")} (fastest first); R0 needs any two of these.`);
  else decisions.push(`${net}: fewer than two full-node RPCs, so R0 would block every payment. Do not build on ${net} until this is fixed.`);
  if (partial.length) decisions.push(`${net}: ${partial.map((e) => e.url).join(", ")} is a partial proxy (Blockscout eth-rpc): use it only for log and block reads, never as one of R0's two endpoints.`);
  return healthy;
}

// ---------- P-2: getLogs window ----------

async function p2(net: NetworkName, eps: Endpoint[]) {
  const windows = [10_000, 5_000, 1_000, 500];
  const details: string[] = [];
  const maxOk: number[] = [];
  for (const ep of eps) {
    let best = 0;
    const notes: string[] = [];
    for (const w of windows) {
      const from = Math.max(0, ep.head - w + 1);
      const r = await rpc<unknown[]>(ep.url, "eth_getLogs", [{
        fromBlock: `0x${from.toString(16)}`, toBlock: `0x${ep.head.toString(16)}`, topics: [TRANSFER_TOPIC0],
      }], 20_000);
      if (r.ok) { best = w; notes.push(`${w} blocks ok (${r.result?.length ?? 0} logs, ${fmtMs(r.ms)})`); break; }
      notes.push(`${w} blocks: ${short(r.error ?? "")}`);
    }
    maxOk.push(best);
    details.push(`${ep.url}: ${notes.join("; ")}`);
  }
  const at5k = maxOk.filter((w) => w >= 5_000).length;
  const usable = Math.min(...maxOk.filter((w) => w > 0), 5_000);
  const status: Status = at5k >= 2 ? "PASS" : maxOk.filter((w) => w > 0).length >= 2 ? "FALLBACK" : "FAIL";
  record({
    id: "P-2", name: "eth_getLogs over 5,000 blocks", network: net, status,
    summary: status === "PASS" ? `5,000-block windows work on ${at5k} endpoints` : `largest window on ≥2 endpoints: ${usable}`,
    details,
  });
  if (status !== "FAIL") decisions.push(`${net}: eth_getLogs window = ${status === "PASS" ? 5_000 : usable} blocks.`);
}

// ---------- P-3: EIP-1559 ----------

async function p3(net: NetworkName, eps: Endpoint[]) {
  const details: string[] = [];
  const fh = await rpcAny<{ baseFeePerGas?: string[] }>(net, eps, "eth_feeHistory", ["0x5", "latest", [50]]);
  const tip = await rpcAny<string>(net, eps, "eth_maxPriorityFeePerGas");
  const gp = await rpcAny<string>(net, eps, "eth_gasPrice");
  const blk = await rpcAny<{ baseFeePerGas?: string }>(net, eps, "eth_getBlockByNumber", ["latest", false]);
  details.push(`eth_feeHistory: ${fh.ok ? `ok, baseFeePerGas ${JSON.stringify(fh.result?.baseFeePerGas?.slice(-2))}` : short(fh.error ?? "")}`);
  details.push(`eth_maxPriorityFeePerGas: ${tip.ok ? `${tip.result} (${hexNum(tip.result!)} wei)` : short(tip.error ?? "")}`);
  details.push(`eth_gasPrice: ${gp.ok ? `${gp.result} (${hexNum(gp.result!) / 1e9} gwei)` : short(gp.error ?? "")}`);
  details.push(`latest block baseFeePerGas: ${blk.ok ? blk.result?.baseFeePerGas ?? "absent" : short(blk.error ?? "")}`);
  const eip1559 = fh.ok && !!blk.result?.baseFeePerGas;
  record({
    id: "P-3", name: "EIP-1559 fee support", network: net, status: eip1559 ? (tip.ok ? "PASS" : "PARTIAL") : "FALLBACK",
    summary: eip1559 ? `EIP-1559 supported${tip.ok ? "" : " (no eth_maxPriorityFeePerGas: compute tip from feeHistory)"}` : "no base fee: use legacy gasPrice",
    details,
  });
  decisions.push(`${net}: transactions use ${eip1559 ? "EIP-1559 fees" : "legacy gasPrice"}.`);
}

// ---------- P-4: EVM version (opcodes via creation-code eth_call; no deploy, no funds) ----------

async function p4(net: NetworkName, eps: Endpoint[]) {
  // Each init code ends in PUSH0/PUSH1 0, RETURN, so success returns "0x".
  const tests: Array<[string, string, string]> = [
    ["control (PUSH1 0 PUSH1 0 RETURN)", "london", "0x60006000f3"],
    ["PUSH0 (0x5f)", "shanghai", "0x5f5ff3"],
    ["TLOAD (0x5c)", "cancun", "0x5f5c505f5ff3"],
    ["MCOPY (0x5e)", "cancun", "0x5f5f5f5e5f5ff3"],
    ["BLOBBASEFEE (0x4a)", "cancun", "0x4a505f5ff3"],
  ];
  const ok: Record<string, boolean> = {};
  const details: string[] = [];
  for (const [label, fork, code] of tests) {
    const r = await rpcAny<string>(net, eps, "eth_call", [{ from: ZERO, data: code, gas: "0x30000" }, "latest"]);
    ok[label] = r.ok;
    details.push(`${label} [${fork}]: ${r.ok ? "executes" : `fails: ${short(r.error ?? "", 90)}`}`);
  }
  const control = ok["control (PUSH1 0 PUSH1 0 RETURN)"];
  const shanghai = ok["PUSH0 (0x5f)"];
  const cancun = ok["TLOAD (0x5c)"] && ok["MCOPY (0x5e)"];
  const evm = !control ? "unknown" : cancun ? "cancun" : shanghai ? "shanghai" : "paris";
  details.push("Method: eth_call with no `to` runs the data as contract creation code, so opcode support is visible without deploying.");
  details.push("Still to do in Phase 1: deploy a contract on testnet with Foundry (needs a funded deployer key).");
  record({
    id: "P-4", name: "EVM version (PUSH0 and Cancun opcodes)", network: net,
    status: !control ? "FAIL" : shanghai ? "PARTIAL" : "FALLBACK",
    summary: control ? `highest supported: ${evm}; testnet deploy pending (Phase 1)` : "eth_call with creation code not supported; probe by deploying instead",
    details,
  });
  if (control) decisions.push(`${net}: foundry evm_version = ${evm === "cancun" ? "cancun (shanghai also safe)" : evm}.`);
  return evm;
}

// ---------- P-5: simulation ----------

async function p5(net: NetworkName, eps: Endpoint[]) {
  const details: string[] = [];
  const target = "0x000000000000000000000000000000000000dEaD";
  // Runtime code: PUSH1 42 PUSH1 0 MSTORE PUSH1 32 PUSH1 0 RETURN -> returns uint256(42)
  const code = "0x602a60005260206000f3";
  const plain = await rpcAny<string>(net, eps, "eth_call", [{ to: target, data: "0x" }, "latest"]);
  details.push(`plain eth_call: ${plain.ok ? `ok (${plain.result})` : short(plain.error ?? "")}`);
  const ov = await rpcAny<string>(net, eps, "eth_call", [{ to: target, data: "0x" }, "latest", { [target]: { code } }]);
  const ovWorks = ov.ok && ov.result !== undefined && ov.result !== "0x" && hexNum(ov.result) === 42;
  details.push(`eth_call with state override: ${ov.ok ? (ovWorks ? "works (returned 42)" : `ignored the override (returned ${ov.result})`) : short(ov.error ?? "")}`);
  const sim = await rpcAny<unknown>(net, eps, "eth_simulateV1", [{ blockStateCalls: [{ stateOverrides: { [target]: { code } }, calls: [{ from: ZERO, to: target, data: "0x" }] }] }, "latest"]);
  details.push(`eth_simulateV1: ${sim.ok ? `works: ${short(JSON.stringify(sim.result), 200)}` : short(sim.error ?? "")}`);
  const est = await rpcAny<string>(net, eps, "eth_estimateGas", [{ from: ZERO, to: target, data: "0x" }]);
  details.push(`eth_estimateGas: ${est.ok ? `ok (${hexNum(est.result!)} gas)` : short(est.error ?? "")}`);
  record({
    id: "P-5", name: "eth_call, state overrides, eth_simulateV1", network: net,
    status: plain.ok && est.ok ? "PASS" : "FAIL",
    summary: `plain call ${plain.ok ? "ok" : "fails"}; overrides ${ovWorks ? "yes" : "no"}; simulateV1 ${sim.ok ? "yes" : "no"}; estimateGas ${est.ok ? "ok" : "fails"}`,
    details,
  });
  decisions.push(`${net}: R5 simulates with plain eth_call from the signer address${ovWorks ? " (state overrides also available for tests)" : ""}.`);
}

// ---------- P-6: QIE MCP server ----------

async function p6(candidates: string[]) {
  const details: string[] = [];
  const client = new Client({ name: "tyrell-probe", version: "0.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  } catch (e) {
    record({ id: "P-6", name: "QIE MCP tools/list and QIE ID round-trip", network: "-", status: "FALLBACK",
      summary: "MCP server unreachable: register payees by raw address", details: [`connect: ${e instanceof Error ? e.message : String(e)}`] });
    decisions.push("Payees are registered by raw address; QIE ID is shown as an unverified label (P-6 fallback).");
    return;
  }
  try {
    const info = client.getServerVersion();
    details.push(`Server: ${info?.name ?? "?"} ${info?.version ?? ""} at ${MCP_URL}`);
    const { tools } = await client.listTools();
    details.push(`${tools.length} tools:`);
    for (const t of tools) {
      const schema = t.inputSchema as { properties?: Record<string, { type?: string }>; required?: string[] };
      const args = Object.entries(schema.properties ?? {})
        .map(([k, v]) => `${k}${schema.required?.includes(k) ? "" : "?"}: ${v.type ?? "any"}`).join(", ");
      details.push(`  \`${t.name}(${args})\` — ${short((t.description ?? "").replace(/\s+/g, " "), 110)}`);
    }
    const nameOf = (re: RegExp) => tools.find((t) => re.test(t.name))?.name;
    const resolveTool = tools.find((t) => /resolve/i.test(t.name) && !/reverse/i.test(t.name));
    const reverseTool = tools.find((t) => /reverse|lookup_address|address_to/i.test(t.name));
    details.push(`Resolve tool: ${resolveTool?.name ?? "none found"}; reverse tool: ${reverseTool?.name ?? "none found"}; network info: ${nameOf(/network|chain_info/i) ?? "none"}`);

    // Liveness: call one tool that needs no arguments.
    const noArg = tools.find((t) => !((t.inputSchema as { required?: string[] }).required?.length));
    if (noArg) {
      const out = await client.callTool({ name: noArg.name, arguments: {} });
      details.push(`Called \`${noArg.name}()\`: ${short(JSON.stringify(out.content), 240)}`);
    }

    // Is QUSDC on QIE's curated token list? (spec open question 1)
    const listTool = tools.find((t) => t.name === "qie_list_tokens");
    if (listTool) {
      const out = await client.callTool({ name: listTool.name, arguments: { network: "mainnet", query: "QUSDC" } });
      const text = JSON.stringify(out.content);
      const listed = text.toLowerCase().includes(QUSDC_MAINNET.toLowerCase());
      details.push(`qie_list_tokens(mainnet, "QUSDC"): reported QUSDC address ${listed ? "IS" : "is NOT"} in the result: ${short(text.replace(/\\n\s*/g, " "), 400)}`);
      decisions.push(`QUSDC ${listed ? "is" : "is not"} returned by the QIE MCP token list (qie_list_tokens).`);
    }

    if (!resolveTool || !reverseTool) {
      record({ id: "P-6", name: "QIE MCP tools/list and QIE ID round-trip", network: "-", status: "FALLBACK",
        summary: `${tools.length} tools listed; no resolve + reverse pair: register payees by raw address`, details });
      decisions.push("Payees are registered by raw address; QIE ID is shown as an unverified label (P-6 fallback).");
      return;
    }

    const argName = (t: (typeof tools)[number]) => {
      const s = t.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      return s.required?.[0] ?? Object.keys(s.properties ?? {})[0] ?? "name";
    };
    const callText = async (t: (typeof tools)[number], value: string) =>
      JSON.stringify((await client.callTool({ name: t.name, arguments: { [argName(t)]: value, network: "mainnet" } })).content);

    // Find a QIE ID to round-trip: PROBE_QIE_ID, else reverse-look-up recent mainnet transfer counterparties.
    let qieId = process.env.PROBE_QIE_ID;
    if (!qieId && candidates.length) {
      for (const a of candidates.slice(0, 15)) {
        const text = await callText(reverseTool, a);
        const m = text.match(/[a-z0-9-]+\.qie\b/i);
        if (m) { qieId = m[0]; details.push(`Found QIE ID ${qieId} by reverse lookup of ${a} (a recent mainnet transfer counterparty).`); break; }
      }
      if (!qieId) details.push(`No QIE ID among ${Math.min(15, candidates.length)} recent transfer counterparties.`);
    }
    if (!qieId) {
      record({ id: "P-6", name: "QIE MCP tools/list and QIE ID round-trip", network: "-", status: "PARTIAL",
        summary: `${tools.length} tools listed; no QIE ID found to round-trip (set PROBE_QIE_ID)`, details });
      return;
    }
    const fwdText = await callText(resolveTool, qieId);
    const addr = fwdText.match(/0x[0-9a-fA-F]{40}/)?.[0];
    details.push(`${resolveTool.name}(${qieId}) → ${short(fwdText.replace(/\\n\s*/g, " "), 200)}`);
    if (!addr) {
      record({ id: "P-6", name: "QIE MCP tools/list and QIE ID round-trip", network: "-", status: "FAIL",
        summary: `resolve returned no address for ${qieId}`, details });
      return;
    }
    const revText = await callText(reverseTool, addr);
    details.push(`${reverseTool.name}(${addr}) → ${short(revText.replace(/\\n\s*/g, " "), 200)}`);
    const roundTrips = revText.toLowerCase().includes(qieId.toLowerCase());
    record({ id: "P-6", name: "QIE MCP tools/list and QIE ID round-trip", network: "-", status: roundTrips ? "PASS" : "FALLBACK",
      summary: roundTrips ? `${qieId} → ${addr} → ${qieId} round-trips` : "reverse lookup does not return the QIE ID", details });
    if (!roundTrips) decisions.push("Payees are registered by raw address; QIE ID is shown as an unverified label (P-6 fallback).");
  } catch (e) {
    details.push(`error: ${e instanceof Error ? e.message : String(e)}`);
    record({ id: "P-6", name: "QIE MCP tools/list and QIE ID round-trip", network: "-", status: "FAIL", summary: "MCP call failed", details });
  } finally {
    await client.close().catch(() => {});
  }
}

/** Distinct addresses from recent mainnet Transfer logs, used to find a real QIE ID for P-6. */
async function transferCounterparties(ep: Endpoint): Promise<string[]> {
  const from = Math.max(0, ep.head - 9_999);
  const r = await rpc<Array<{ topics: string[] }>>(ep.url, "eth_getLogs", [{
    fromBlock: `0x${from.toString(16)}`, toBlock: `0x${ep.head.toString(16)}`, topics: [TRANSFER_TOPIC0],
  }], 20_000);
  const out = new Set<string>();
  for (const log of r.result ?? []) for (const t of log.topics.slice(1, 3)) {
    const a = `0x${t.slice(-40)}`;
    if (!/^0x0{40}$/.test(a)) out.add(a);
  }
  return [...out];
}

// ---------- P-7: QUSDC ----------

async function p7(eps: Endpoint[]) {
  const details: string[] = [];
  const addr = process.env.QUSDC_ADDRESS ?? QUSDC_MAINNET;
  const reads: Record<string, string>[] = [];
  for (const ep of eps.slice(0, 2)) {
    const code = await rpc<string>(ep.url, "eth_getCode", [addr, "latest"]);
    const out: Record<string, string> = { codeBytes: code.ok ? String((code.result!.length - 2) / 2) : `error ${code.error}` };
    for (const fn of ["name", "symbol", "decimals", "totalSupply"] as const) {
      const r = await rpc<Hex>(ep.url, "eth_call", [{ to: addr, data: encodeFunctionData({ abi: erc20Abi, functionName: fn }) }, "latest"]);
      out[fn] = r.ok && r.result && r.result !== "0x"
        ? String(decodeFunctionResult({ abi: erc20Abi, functionName: fn, data: r.result }))
        : `error ${short(r.error ?? "empty result", 80)}`;
    }
    const impl = await rpc<string>(ep.url, "eth_getStorageAt", [addr, EIP1967_IMPL, "latest"]);
    out.eip1967Impl = impl.ok && impl.result && hexToBigInt(impl.result as Hex) !== 0n ? `0x${impl.result.slice(-40)}` : "none";
    reads.push(out);
    details.push(`${ep.url}: ${JSON.stringify(out)}`);
  }
  const [a, b] = reads;
  const agree = !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  const decimals = a?.decimals === "6";
  const symbolOk = /qusdc/i.test(a?.symbol ?? "");
  const hasCode = Number(a?.codeBytes ?? 0) > 0;
  details.push(`Reported: QUSDC, 6 decimals, 1:1 receipt for WUSDC. Two endpoints ${agree ? "agree" : "DISAGREE"}.`);
  if (a?.eip1967Impl && a.eip1967Impl !== "none") details.push(`QUSDC is an EIP-1967 proxy (implementation ${a.eip1967Impl}): its owner can change its behaviour.`);
  details.push("Confirm with the QIE team in Discord that this is the official stablecoin before funding the vault.");
  const pass = hasCode && decimals && symbolOk && agree;
  record({
    id: "P-7", name: "QUSDC name, symbol, decimals, totalSupply", network: "mainnet",
    status: pass ? "PASS" : hasCode ? "PARTIAL" : "FALLBACK",
    summary: hasCode
      ? `${a?.name} (${a?.symbol}), ${a?.decimals} decimals, supply ${a?.totalSupply}${pass ? "; matches report" : "; differs from report"}`
      : "no contract at the reported address: use TyrellTestUSD on testnet",
    details,
  });
  decisions.push(pass
    ? `QUSDC at ${addr} matches the report on-chain; Discord confirmation still required before funding.`
    : `QUSDC unconfirmed: deploy TyrellTestUSD on testnet for M1.`);
}

// ---------- P-8: explorer verification API ----------

async function p8(net: NetworkName) {
  const base = networks[net].explorer;
  const details: string[] = [];
  const getJson = async (path: string) => {
    try {
      const r = await fetch(base + path, { signal: AbortSignal.timeout(8000) });
      const ct = r.headers.get("content-type") ?? "";
      const body = await r.text();
      return { status: r.status, json: ct.includes("json") ? body.trim() : undefined, ct };
    } catch (e) { return { status: 0, json: undefined, ct: e instanceof Error ? e.message : String(e) }; }
  };
  const v2 = await getJson("/api/v2/config/backend-version");
  const v2stats = await getJson("/api/v2/stats");
  const v1 = await getJson("/api?module=block&action=eth_block_number");
  const verCfg = await getJson("/api/v2/smart-contracts/verification/config");
  details.push(`GET /api/v2/config/backend-version: ${v2.status} ${v2.json ? short(v2.json, 120) : v2.ct}`);
  details.push(`GET /api/v2/stats: ${v2stats.status} ${v2stats.json ? short(v2stats.json, 120) : v2stats.ct}`);
  details.push(`GET /api?module=block&action=eth_block_number (Etherscan-style): ${v1.status} ${v1.json ? short(v1.json, 120) : v1.ct}`);
  details.push(`GET /api/v2/smart-contracts/verification/config: ${verCfg.status} ${verCfg.json ? short(verCfg.json, 200) : verCfg.ct}`);
  const blockscout = !!(v2.json || v2stats.json);
  const etherscanApi = !!v1.json;
  details.push("Source verification itself needs a deployed contract: done with the first testnet deploy in Phase 1.");
  record({
    id: "P-8", name: "Explorer verification API", network: net,
    status: blockscout || etherscanApi ? "PARTIAL" : "FALLBACK",
    summary: blockscout
      ? `Blockscout API detected${etherscanApi ? " (Etherscan-style /api too)" : ""}; verify on first deploy`
      : etherscanApi ? "Etherscan-style /api only" : "no JSON API found: plan on the web form with flattened sources",
    details,
  });
  if (blockscout || etherscanApi) decisions.push(`${net}: forge verify-contract --verifier blockscout --verifier-url ${base}/api/ (confirm on first deploy).`);
}

// ---------- P-10: Pinata ----------

async function p10() {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    record({ id: "P-10", name: "Pin and fetch a 4 KB encrypted blob", network: "-", status: "SKIP",
      summary: "set PINATA_JWT (and PINATA_GATEWAY) and re-run", details: ["No PINATA_JWT in the environment."] });
    return;
  }
  const details: string[] = [];
  const subtle = webcrypto.subtle;
  const key = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode("tyrell-probe");
  const plain = webcrypto.getRandomValues(new Uint8Array(4096));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plain));
  const blob = new Uint8Array(iv.length + ct.length); blob.set(iv); blob.set(ct, iv.length);
  const t0 = performance.now();
  const form = new FormData();
  form.append("file", new Blob([blob]), "tyrell-probe.bin");
  form.append("network", "public");
  const up = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: form });
  const upBody = await up.json().catch(() => ({})) as { data?: { cid?: string } };
  const cid = upBody.data?.cid;
  const tPin = performance.now() - t0;
  details.push(`upload: HTTP ${up.status}, cid ${cid ?? "none"}, ${fmtMs(tPin)}`);
  if (!cid) { record({ id: "P-10", name: "Pin and fetch a 4 KB encrypted blob", network: "-", status: "FAIL", summary: "upload failed", details }); return; }
  const gateways = [process.env.PINATA_GATEWAY, "https://ipfs.io", "https://dweb.link"].filter(Boolean) as string[];
  for (const gw of gateways) {
    const t1 = performance.now();
    try {
      const r = await fetch(`${gw.replace(/\/$/, "")}/ipfs/${cid}`, { signal: AbortSignal.timeout(15_000) });
      const got = new Uint8Array(await r.arrayBuffer());
      const pt = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: got.slice(0, 12), additionalData: aad }, key, got.slice(12)));
      const same = pt.length === plain.length && pt.every((v, i) => v === plain[i]);
      const total = tPin + (performance.now() - t1);
      details.push(`fetch via ${gw}: HTTP ${r.status}, decrypts ${same ? "ok" : "WRONG"}, round-trip ${fmtMs(total)}`);
      record({ id: "P-10", name: "Pin and fetch a 4 KB encrypted blob", network: "-", status: same && total < 3000 ? "PASS" : same ? "PARTIAL" : "FAIL",
        summary: `round-trip ${fmtMs(total)} via ${gw}`, details });
      return;
    } catch (e) { details.push(`fetch via ${gw}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  record({ id: "P-10", name: "Pin and fetch a 4 KB encrypted blob", network: "-", status: "FAIL", summary: "pinned but no gateway returned it", details });
}

// ---------- P-11: block time ----------

async function p11(net: NetworkName, eps: Endpoint[]) {
  const headOut = await rpcAny<string>(net, eps, "eth_blockNumber");
  const head = headOut.result;
  if (!head) { record({ id: "P-11", name: "Block time", network: net, status: "FAIL", summary: "no head", details: [] }); return; }
  const n = hexNum(head);
  const nums = Array.from({ length: 101 }, (_, i) => n - 100 + i);
  const ts: number[] = new Array(101);
  for (let i = 0; i < nums.length; i += 10) {
    await Promise.all(nums.slice(i, i + 10).map(async (b, j) => {
      const r = await rpcAny<{ timestamp: string }>(net, eps, "eth_getBlockByNumber", [`0x${b.toString(16)}`, false]);
      if (r.ok && r.result) ts[i + j] = hexNum(r.result.timestamp);
    }));
  }
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) if (ts[i] !== undefined && ts[i - 1] !== undefined) gaps.push(ts[i]! - ts[i - 1]!);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const summary = `mean ${mean.toFixed(2)} s over ${gaps.length} intervals (min ${Math.min(...gaps)} s, max ${Math.max(...gaps)} s, median ${median(gaps)} s)`;
  record({ id: "P-11", name: "Block time from 100 consecutive blocks", network: net, status: gaps.length >= 90 ? "PASS" : "PARTIAL", summary,
    details: [`Blocks ${nums[0]}–${nums[100]} on ${headOut.url ?? "?"}: ${summary}`] });
  const confirmBlocks = Math.max(1, Math.ceil(6 / Math.max(mean, 0.5)));
  decisions.push(`${net}: block time ≈ ${mean.toFixed(1)} s; sentinel poll 15 s covers ~${Math.round(15 / mean)} blocks; wait ${confirmBlocks} confirmation(s) (~6 s) before treating an anchor as final.`);
}

// ---------- P-9: QIE Wallet (manual) ----------

function p9() {
  record({
    id: "P-9", name: "QIE Wallet: EIP-6963, switch chain, typed data, tx", network: "testnet", status: "MANUAL",
    summary: "open scripts/probe-wallet.html in a browser with QIE Wallet installed",
    details: [
      "Needs a browser with the QIE Wallet extension, so it cannot run here.",
      "Serve the page locally (`npx serve scripts` or `python3 -m http.server -d scripts`) and open /probe-wallet.html.",
      "It discovers the wallet by rdns me.qiewallet, switches to 1983, signs EIP-712 typed data, verifies the signature, and sends a 0-value self-transfer. Paste its result table here.",
    ],
  });
}

// ---------- report ----------

function writeReport(evm: Partial<Record<NetworkName, string>>) {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push("# PROBE.md — Phase 0 results", "");
  lines.push(`Run ${now} with \`pnpm probe\` (scripts/probe.ts), Node ${process.version}. Read-only: no transactions, no keys.`, "");
  lines.push("Status: PASS = spec pass condition met · PARTIAL = met as far as this machine can check, rest noted · FALLBACK = take the spec's fallback · FAIL · SKIP = needs a credential · MANUAL = needs a browser wallet.", "");
  lines.push("| Probe | Network | Status | Result |", "| --- | --- | --- | --- |");
  for (const r of results) lines.push(`| ${r.id} ${r.name} | ${r.network} | ${r.status} | ${r.summary.replace(/\|/g, "\\|")} |`);
  lines.push("", "## Decisions for the build", "");
  for (const d of decisions) lines.push(`- ${d}`);
  if (evm.mainnet && evm.testnet && evm.mainnet !== evm.testnet) lines.push(`- EVM versions differ (mainnet ${evm.mainnet}, testnet ${evm.testnet}): compile for the lower one.`);
  for (const [net, set] of Object.entries(drops)) if (set?.size)
    lines.push(`- ${net}: ${[...set].join(", ")} stopped answering during the run after passing P-1. Treat every endpoint as flaky: the fallback transport and R0's two-endpoint check are required, not optional.`);
  lines.push("", "## Details", "");
  for (const r of results) {
    lines.push(`### ${r.id} ${r.name}${r.network !== "-" ? ` (${r.network})` : ""}`, "", `**${r.status}**: ${r.summary}`, "");
    for (const d of r.details) lines.push(d.startsWith("  ") ? `    - ${d.trim()}` : `- ${d}`);
    lines.push("");
  }
  writeFileSync(new URL("../PROBE.md", import.meta.url), lines.join("\n"));
  console.log("\nWrote PROBE.md");
}

async function main() {
  const only = process.argv.includes("--network") ? process.argv[process.argv.indexOf("--network") + 1] as NetworkName : undefined;
  const nets: NetworkName[] = only ? [only] : ["mainnet", "testnet"];
  const evm: Partial<Record<NetworkName, string>> = {};
  let mainnetEps: Endpoint[] = [];
  for (const net of nets) {
    console.log(`\n== ${net} ==`);
    const eps = await p1(net);
    if (net === "mainnet") mainnetEps = eps;
    const best = eps[0];
    if (!best) continue;
    await p2(net, eps);
    await p3(net, eps);
    evm[net] = await p4(net, eps);
    await p5(net, eps);
    await p11(net, eps);
    await p8(net);
  }
  console.log("\n== off-chain ==");
  if (mainnetEps.length) await p7(mainnetEps);
  await p6(mainnetEps[0] ? await transferCounterparties(mainnetEps[0]) : []);
  p9();
  await p10();
  const order = (id: string) => Number(id.slice(2));
  results.sort((a, b) => order(a.id) - order(b.id) || a.network.localeCompare(b.network));
  writeReport(evm);
  const failed = results.filter((r) => r.status === "FAIL");
  if (failed.length) { console.log(`${failed.length} probe(s) failed.`); process.exitCode = 1; }
}

await main();
