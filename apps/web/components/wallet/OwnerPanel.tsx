"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, createWalletClient, custom, getAddress, http, isAddress, isAddressEqual, zeroAddress, type Address, type PublicClient } from "viem";
import { createKey, download, type KeystoreV3, type Role } from "@/lib/keystore";
import { CHAINS, chainName, useWallet } from "@/lib/wallet";
import type { ViewDocument } from "@/lib/view";
import { Avatar, ConnectButton } from "./Wallet";

const anchorAbi = [{ type: "function", name: "registry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const registryAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "activeKey", stateMutability: "view", inputs: [{ type: "uint8", name: "lane" }], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "laneOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "key" }],
    outputs: [
      { type: "uint8", name: "lane" },
      { type: "bool", name: "active" },
      { type: "uint64", name: "addedAt" },
      { type: "uint64", name: "revokedAt" },
    ],
  },
  { type: "function", name: "revokeLaneKey", stateMutability: "nonpayable", inputs: [{ type: "address", name: "key" }, { type: "string", name: "reason" }], outputs: [] },
  { type: "function", name: "addLaneKey", stateMutability: "nonpayable", inputs: [{ type: "uint8", name: "lane" }, { type: "address", name: "key" }], outputs: [] },
  { type: "function", name: "rotateLaneKey", stateMutability: "nonpayable", inputs: [{ type: "address", name: "oldKey" }, { type: "address", name: "newKey" }, { type: "string", name: "reason" }], outputs: [] },
] as const;

const LANES: Array<[number, string, string]> = [
  [1, "user", "Your instructions"],
  [2, "agent", "Steward, the AI agent"],
  [3, "wallet", "Incoming transfers"],
  [4, "control", "Policy and payments"],
];

interface Reading {
  registry: Address;
  owner: Address;
  keys: Record<number, Address>;
  mine?: { lane: number; active: boolean };
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * The console's Account tab. Reads who owns the deployment this console shows and which key each
 * lane uses. If the connected wallet is the owner, a lane key can be revoked from here: the
 * emergency stop. Every write is a normal wallet transaction the owner approves.
 */
export function OwnerPanel({ view }: { view: ViewDocument }) {
  const w = useWallet();
  const [r, setR] = useState<Reading>();
  const [err, setErr] = useState<string>();
  const [loading, setLoading] = useState(false);
  const target = view.chainId;
  const sameChain = w.chainId === target;
  // only QIE's public networks can be read from here; a local test chain (anvil, 31337) lives on someone's computer
  const publicRpc = CHAINS[target] && !CHAINS[target]!.rpcUrls[0]!.includes("127.0.0.1") ? CHAINS[target]!.rpcUrls[0] : undefined;
  const reachable = !!publicRpc;

  const client = useCallback((): PublicClient | undefined => {
    if (w.wallet && sameChain) return createPublicClient({ transport: custom(w.wallet.provider) }) as PublicClient;
    if (publicRpc) return createPublicClient({ transport: http(publicRpc) }) as PublicClient;
    return undefined;
  }, [w.wallet, sameChain, publicRpc]);

  const load = useCallback(async () => {
    const c = client();
    const anchor = view.contracts.memoryAnchor as Address | undefined;
    if (!c || !anchor) return;
    setLoading(true);
    setErr(undefined);
    try {
      const registry = await c.readContract({ address: anchor, abi: anchorAbi, functionName: "registry" });
      const owner = await c.readContract({ address: registry, abi: registryAbi, functionName: "owner" });
      const keys: Record<number, Address> = {};
      for (const [lane] of LANES) keys[lane] = await c.readContract({ address: registry, abi: registryAbi, functionName: "activeKey", args: [lane] });
      let mine: Reading["mine"];
      if (w.account) {
        const [lane, active] = await c.readContract({ address: registry, abi: registryAbi, functionName: "laneOf", args: [w.account] });
        if (lane > 0) mine = { lane, active };
      }
      setR({ registry, owner, keys, ...(mine ? { mine } : {}) });
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [client, view.contracts.memoryAnchor, w.account]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = !!(w.account && r && isAddressEqual(r.owner, w.account));
  // "Viewer" only once the registry was actually read; before that (or when it cannot be read) the role is unknown
  const role = !w.account ? undefined : !r ? "unknown" : isOwner ? "Owner" : r.mine ? `${LANES.find((l) => l[0] === r.mine!.lane)?.[1]} lane key${r.mine.active ? "" : " (revoked)"}` : "Viewer";
  const canRead = !!client();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section className="rounded-xl border border-line bg-white p-5">
        <h3 className="mono mb-4 text-[12px] uppercase tracking-wider text-muted">You</h3>
        {!w.account ? (
          <div>
            <p className="text-sm text-body">Connect the owner wallet to manage keys.</p>
            <ConnectButton className="mt-4" />
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <Avatar address={w.account} size={34} />
              <div className="min-w-0">
                <div className="mono truncate text-ink">{w.account}</div>
                <div className="text-xs text-muted">
                  {w.wallet?.name} · {chainName(w.chainId)} · {w.session ? "signed in" : "not signed in"}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body">Role here:</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs ${isOwner ? "bg-brand text-white" : "bg-paper text-body"}`}>{loading && !r ? "checking…" : (role ?? "—")}</span>
            </div>
            {!w.session && (
              <button onClick={w.signIn} className="rounded-lg bg-brand px-4 py-2 text-sm text-white transition-colors hover:bg-brand-deep">
                Sign in
              </button>
            )}
          </div>
        )}

        {w.account && !sameChain && reachable && (
          <button onClick={() => w.switchTo(target)} className="mt-4 rounded-lg border border-line px-3 py-2 text-sm text-ink transition-colors hover:bg-paper">
            Switch wallet to {chainName(target)}
          </button>
        )}
      </section>

      <section className="rounded-xl border border-line bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <h3 className="mono text-[12px] uppercase tracking-wider text-muted">Lane keys</h3>
          {r && (
            <span className="mono ml-auto text-[11px] text-muted" title={r.registry}>
              registry {short(r.registry)}
            </span>
          )}
        </div>
        {err && <p className="mb-3 rounded-lg bg-[#ffe9ed] px-3 py-2 text-[13px] text-rose">Could not read the registry: {err}</p>}
        {!r && !err && canRead && <p className="text-sm text-muted">Reading…</p>}
        {!r && !err && !canRead && (
          <div className="space-y-2 text-sm text-body">
            <p>
              {target === 31337
                ? "This console is showing a run recorded on a local test chain, which only exists on the computer that recorded it."
                : `This console is showing a deployment on ${chainName(target)}, which this page cannot read.`}{" "}
              There are no keys to manage from here.
            </p>
            <p className="text-[13px] text-muted">
              To manage your own keys, run the console next to your Tyrell deployment on QIE (set <span className="mono">TYRELL_API_URL</span> to control&apos;s view, see the{" "}
              <a href="/docs/guides/web-console-and-wallet" className="text-brand hover:underline">
                console guide
              </a>
              ). On that machine, <span className="mono">pnpm tyrell revoke</span> works too.
            </p>
          </div>
        )}
        {r && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-paper px-3 py-2 text-sm">
              <span className="text-body">Owner</span>
              <span className="mono text-ink">{short(r.owner)}</span>
              {isOwner && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] text-white">you</span>}
            </div>
            <ul className="divide-y divide-line">
              {LANES.map(([lane, name, what]) => (
                <KeyRow key={lane} lane={lane} name={name} what={what} keyAddr={r.keys[lane]!} canRevoke={isOwner && sameChain} registry={r.registry} onDone={load} />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

type Mode = "add" | "replace" | "revoke";

function KeyRow({ lane, name, what, keyAddr, canRevoke, registry, onDone }: { lane: number; name: string; what: string; keyAddr: Address; canRevoke: boolean; registry: Address; onDone: () => void }) {
  const w = useWallet();
  const [mode, setMode] = useState<Mode>();
  const [source, setSource] = useState<"create" | "paste">("create");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pasted, setPasted] = useState("");
  const [reason, setReason] = useState("suspected compromise");
  const [state, setState] = useState<string>();
  // one key per attempt: created once, downloaded, and reused by every retry until the row is closed
  const [made, setMade] = useState<{ address: Address; keystore: KeystoreV3 }>();
  const [saved, setSaved] = useState(false);
  const creating = useRef(false);
  const none = isAddressEqual(keyAddr, zeroAddress);
  const busy = !!state?.startsWith("Confirm") || !!state?.startsWith("Waiting") || !!state?.startsWith("Creating");
  const file = `${name}.json`;

  const close = () => {
    setMode(undefined);
    setState(undefined);
    setPw("");
    setPw2("");
    setPasted("");
    setMade(undefined);
    setSaved(false);
  };

  const errText = (e: unknown) => {
    const x = e as { code?: number; shortMessage?: string; message?: string };
    return x.code === 4001 ? "Cancelled in the wallet." : (x.shortMessage ?? x.message ?? String(e));
  };

  /** Step 1 of "create": make the key and download it encrypted. */
  const make = async () => {
    if (creating.current || made) return;
    try {
      if (pw.length < 8) throw new Error("The password must be at least 8 characters.");
      if (pw !== pw2) throw new Error("The two passwords differ.");
      creating.current = true;
      setState("Creating the key…");
      const k = await createKey(name as Role, pw);
      setMade({ address: k.address!, keystore: k.keystore });
      download(file, k.keystore);
      setPw("");
      setPw2("");
      setState(undefined);
    } catch (e) {
      setState(errText(e));
    } finally {
      creating.current = false;
    }
  };

  const run = async () => {
    if (!w.wallet || !w.account) return;
    try {
      const wc = createWalletClient({ account: w.account, transport: custom(w.wallet.provider) });
      let hash: `0x${string}`;
      if (mode === "revoke") {
        setState("Confirm in your wallet…");
        hash = await wc.writeContract({ address: registry, abi: registryAbi, functionName: "revokeLaneKey", args: [keyAddr, reason], chain: null });
      } else {
        let next: Address;
        if (source === "paste") {
          if (!isAddress(pasted.trim())) throw new Error("That is not an address.");
          next = getAddress(pasted.trim());
        } else {
          if (!made) throw new Error("Create the key file first.");
          if (!saved) throw new Error(`Confirm that you saved ${file} first.`);
          next = made.address;
        }
        setState("Confirm in your wallet…");
        hash =
          mode === "add"
            ? await wc.writeContract({ address: registry, abi: registryAbi, functionName: "addLaneKey", args: [lane, next], chain: null })
            : await wc.writeContract({ address: registry, abi: registryAbi, functionName: "rotateLaneKey", args: [keyAddr, next, reason], chain: null });
      }
      setState("Waiting for the block…");
      const receipt = await createPublicClient({ transport: custom(w.wallet.provider) }).waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction failed on-chain, so nothing changed. You can try again.");
      close();
      onDone();
    } catch (e) {
      setState(errText(e));
    }
  };

  const field = "mt-1 w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand";
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-16 text-sm font-medium text-ink">{name}</span>
        <span className={`mono text-[13px] ${none ? "text-muted" : "text-body"}`}>{none ? "no active key" : short(keyAddr)}</span>
        {canRevoke && (
          <span className="ml-auto flex gap-2">
            {none ? (
              <button onClick={() => (mode ? close() : setMode("add"))} className="rounded-md border border-brand/40 px-2.5 py-1 text-xs text-brand transition-colors hover:bg-brand-50">
                {mode ? "Cancel" : "Add key"}
              </button>
            ) : mode ? (
              <button onClick={close} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink transition-colors hover:bg-paper">
                Cancel
              </button>
            ) : (
              <>
                <button onClick={() => setMode("replace")} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink transition-colors hover:bg-paper">
                  Replace
                </button>
                <button onClick={() => setMode("revoke")} className="rounded-md border border-rose/40 px-2.5 py-1 text-xs text-rose transition-colors hover:bg-[#ffe9ed]">
                  Revoke
                </button>
              </>
            )}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted">{what}</p>
      {mode && (
        <div className={`mt-3 rounded-lg border p-3 ${mode === "revoke" ? "border-rose/30 bg-[#fff7f8]" : "border-brand/30 bg-brand-50/40"}`}>
          {mode !== "revoke" && (
            <>
              <div className="inline-flex rounded-md border border-line bg-white p-0.5 text-xs" role="group">
                {(
                  [
                    ["create", "Create a new key here"],
                    ["paste", "Use a key I already have"],
                  ] as const
                ).map(([s2, l]) => (
                  <button key={s2} onClick={() => setSource(s2)} aria-pressed={source === s2} className={`rounded px-2.5 py-1 ${source === s2 ? "bg-brand text-white" : "text-body"}`}>
                    {l}
                  </button>
                ))}
              </div>
              {source === "create" ? (
                made ? (
                  <div className="mt-2 space-y-2 text-xs text-body">
                    <p>
                      New {name} key <span className="mono text-ink">{short(made.address)}</span>, downloaded as <span className="mono">{file}</span> (encrypted). It is the only copy: put it in{" "}
                      <span className="mono">~/.tyrell/keys/</span> and the password in that role&apos;s passphrase file.{" "}
                      <button onClick={() => download(file, made.keystore)} className="text-brand hover:underline">
                        Download again
                      </button>
                    </p>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I saved {file}
                    </label>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <label className="block text-xs text-body">
                      Password to encrypt the key file
                      <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={field} />
                    </label>
                    <label className="block text-xs text-body">
                      Same password again
                      <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={field} />
                    </label>
                    <p className="text-[11px] text-muted">
                      Downloads as <span className="mono">{file}</span>, encrypted. The key is made in this page and never sent anywhere.
                    </p>
                  </div>
                )
              ) : (
                <label className="mt-2 block text-xs text-body">
                  Key address (from <span className="mono">pnpm tyrell setup keys</span>)
                  <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="0x…" className={`${field} mono`} />
                </label>
              )}
            </>
          )}
          {mode !== "add" && (
            <label className="mt-2 block text-xs text-body">
              Reason, recorded on-chain
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
            </label>
          )}
          {mode !== "revoke" && source === "create" && !made ? (
            <button onClick={make} disabled={busy} className="mt-2 w-full rounded-md bg-brand py-2 text-sm text-white transition-opacity disabled:opacity-60">
              Create and download {file}
            </button>
          ) : (
            <button
              onClick={run}
              disabled={busy || (mode !== "add" && !reason) || (mode !== "revoke" && source === "create" && !saved)}
              className={`mt-2 w-full rounded-md py-2 text-sm text-white transition-opacity disabled:opacity-60 ${mode === "revoke" ? "bg-rose" : "bg-brand"}`}
            >
              {mode === "add" ? `Add the ${name} key` : mode === "replace" ? `Replace the ${name} key` : `Revoke the ${name} key`}
            </button>
          )}
          {state && <p className="mt-2 text-xs text-body">{state}</p>}
          {mode === "revoke" && <p className="mt-2 text-[11px] text-muted">Lane {lane}. A revoked key can never be re-added.</p>}
        </div>
      )}
    </li>
  );
}
