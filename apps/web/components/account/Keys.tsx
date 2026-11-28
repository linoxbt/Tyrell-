"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, custom, getAddress, http, isAddress, isAddressEqual, type Address, type PublicClient } from "viem";
import { abi, LANES, noKey, ownerTx } from "@/lib/account";
import { createKey, download } from "@/lib/keystore";
import { CHAINS, chainName, useWallet } from "@/lib/wallet";
import { Avatar, ConnectButton } from "../wallet/Wallet";

/*
 * Lane keys: one key per lane, held by one process. The owner wallet adds a key (pasted, or created here
 * and downloaded encrypted), replaces it, or revokes it. Every change is a wallet transaction.
 */

interface Reading {
  registry: Address;
  owner: Address;
  keys: Record<number, Address>;
  mine?: { lane: number; active: boolean };
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function useReader(chainId: number) {
  const w = useWallet();
  const sameChain = w.chainId === chainId;
  const rpc = CHAINS[chainId] && chainId !== 31337 ? CHAINS[chainId]!.rpcUrls[0] : undefined;
  return useCallback((): PublicClient | undefined => {
    if (w.wallet && sameChain) return createPublicClient({ transport: custom(w.wallet.provider) }) as PublicClient;
    if (rpc) return createPublicClient({ transport: http(rpc) }) as PublicClient;
    return undefined;
  }, [w.wallet, sameChain, rpc]);
}

export function Keys({ chainId, laneRegistry, memoryAnchor }: { chainId: number; laneRegistry?: Address; memoryAnchor?: Address }) {
  const w = useWallet();
  const reader = useReader(chainId);
  const [r, setR] = useState<Reading>();
  const [err, setErr] = useState<string>();
  const sameChain = w.chainId === chainId;

  const load = useCallback(async () => {
    const c = reader();
    if (!c) return;
    setErr(undefined);
    try {
      const registry = laneRegistry ?? ((await c.readContract({ address: memoryAnchor!, abi: abi("MemoryAnchor"), functionName: "registry" })) as Address);
      const reg = { address: registry, abi: abi("LaneRegistry") } as const;
      const owner = (await c.readContract({ ...reg, functionName: "owner" })) as Address;
      const keys: Record<number, Address> = {};
      for (const l of LANES) keys[l.lane] = (await c.readContract({ ...reg, functionName: "activeKey", args: [l.lane] })) as Address;
      let mine: Reading["mine"];
      if (w.account) {
        const [lane, active] = (await c.readContract({ ...reg, functionName: "laneOf", args: [w.account] })) as [number, boolean];
        if (lane > 0) mine = { lane, active };
      }
      setR({ registry, owner, keys, ...(mine ? { mine } : {}) });
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? String(e));
    }
  }, [reader, laneRegistry, memoryAnchor, w.account]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = !!(w.account && r && isAddressEqual(r.owner, w.account));
  const role = !w.account ? undefined : isOwner ? "Owner" : r?.mine ? `${LANES.find((l) => l.lane === r.mine!.lane)?.name} lane key${r.mine.active ? "" : " (revoked)"}` : "Viewer";
  const canEdit = isOwner && sameChain;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <section className="h-fit rounded-xl border border-line bg-white p-5">
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
                <div className="text-xs text-muted">{chainName(w.chainId)}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body">Role here:</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs ${isOwner ? "bg-brand text-white" : "bg-paper text-body"}`}>{!r && !err ? "checking…" : (role ?? "—")}</span>
            </div>
            {!sameChain && (
              <button onClick={() => w.switchTo(chainId)} className="rounded-lg border border-line px-3 py-2 text-sm text-ink transition-colors hover:bg-paper">
                Switch wallet to {chainName(chainId)}
              </button>
            )}
            {r && !isOwner && <p className="text-xs text-muted">Only the owner ({short(r.owner)}) can change keys.</p>}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <h3 className="mono text-[12px] uppercase tracking-wider text-muted">Lane keys</h3>
          {r && (
            <span className="mono ml-auto text-[11px] text-muted" title={r.registry}>
              registry {short(r.registry)}
            </span>
          )}
        </div>
        <p className="mb-3 text-[13px] text-muted">Each part of Tyrell signs with its own key. A key can only write to its own lane.</p>
        {err && <p className="mb-3 rounded-lg bg-[#ffe9ed] px-3 py-2 text-[13px] text-rose">Could not read the keys: {err}</p>}
        {!r && !err && <p className="text-sm text-muted">{reader() ? "Reading…" : "Connect a wallet to see the keys."}</p>}
        {r && (
          <ul className="divide-y divide-line">
            {LANES.map((l) => (
              <KeyRow key={l.lane} lane={l.lane} name={l.name} what={`${l.what} · held by ${l.process}`} keyAddr={r.keys[l.lane]!} canEdit={canEdit} registry={r.registry} onDone={load} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Mode = "add" | "replace" | "revoke";

function KeyRow({ lane, name, what, keyAddr, canEdit, registry, onDone }: { lane: number; name: "user" | "agent" | "wallet" | "control"; what: string; keyAddr: Address; canEdit: boolean; registry: Address; onDone: () => void }) {
  const w = useWallet();
  const none = noKey(keyAddr);
  const [mode, setMode] = useState<Mode>();
  const [source, setSource] = useState<"create" | "paste">("create");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pasted, setPasted] = useState("");
  const [reason, setReason] = useState("suspected compromise");
  const [state, setState] = useState<string>();
  const [busy, setBusy] = useState(false);

  const close = () => {
    setMode(undefined);
    setState(undefined);
    setPw("");
    setPw2("");
    setPasted("");
  };

  async function run() {
    if (!w.wallet || !w.account) return;
    setBusy(true);
    try {
      if (mode === "revoke") {
        setState("Confirm in your wallet…");
        await ownerTx(w.wallet.provider, w.account, registry, "LaneRegistry", "revokeLaneKey", [keyAddr, reason]);
      } else {
        let next: Address;
        if (source === "paste") {
          if (!isAddress(pasted.trim())) throw new Error("That is not an address.");
          next = getAddress(pasted.trim());
        } else {
          if (pw.length < 8) throw new Error("The password must be at least 8 characters.");
          if (pw !== pw2) throw new Error("The two passwords differ.");
          setState("Creating the key…");
          const k = await createKey(name, pw);
          next = k.address!;
          download(`${name}.json`, k.keystore);
        }
        setState("Confirm in your wallet…");
        if (mode === "add") await ownerTx(w.wallet.provider, w.account, registry, "LaneRegistry", "addLaneKey", [lane, next]);
        else await ownerTx(w.wallet.provider, w.account, registry, "LaneRegistry", "rotateLaneKey", [keyAddr, next, reason]);
      }
      close();
      onDone();
    } catch (e) {
      const x = e as { code?: number; shortMessage?: string; message?: string };
      setState(x.code === 4001 ? "Cancelled in the wallet." : (x.shortMessage ?? x.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand";
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="w-16 text-sm font-medium text-ink">{name}</span>
        <span className={`mono text-[13px] ${none ? "text-muted" : "text-body"}`}>{none ? "no active key" : short(keyAddr)}</span>
        {canEdit && !mode && (
          <span className="ml-auto flex gap-2">
            {none ? (
              <button onClick={() => setMode("add")} className="rounded-md bg-brand px-3 py-1 text-xs text-white transition-colors hover:bg-brand-deep">
                Add key
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
                ).map(([s, l]) => (
                  <button key={s} onClick={() => setSource(s)} aria-pressed={source === s} className={`rounded px-2.5 py-1 ${source === s ? "bg-brand text-white" : "text-body"}`}>
                    {l}
                  </button>
                ))}
              </div>
              {source === "create" ? (
                <div className="mt-3 space-y-2">
                  <label className="block text-xs text-body">
                    Password to encrypt the key file
                    <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={field} />
                  </label>
                  <label className="block text-xs text-body">
                    Same password again
                    <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={field} />
                  </label>
                  <p className="text-[11px] leading-relaxed text-muted">
                    Your browser makes the key and downloads it as <span className="mono">{name}.json</span>, encrypted. Put it in <span className="mono">~/.tyrell/keys/</span> on the computer that runs Tyrell, and use the
                    same password as your Tyrell passphrase.
                  </p>
                </div>
              ) : (
                <label className="mt-3 block text-xs text-body">
                  Key address (from <span className="mono">pnpm tyrell setup keys</span>)
                  <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="0x…" className={`${field} mono`} />
                </label>
              )}
            </>
          )}
          {mode !== "add" && (
            <label className="mt-3 block text-xs text-body">
              Reason, recorded on-chain
              <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
            </label>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={run} disabled={busy || (mode !== "add" && !reason)} className={`rounded-md px-3 py-2 text-sm text-white transition-opacity disabled:opacity-60 ${mode === "revoke" ? "bg-rose" : "bg-brand"}`}>
              {mode === "add" ? `Add the ${name} key` : mode === "replace" ? `Replace the ${name} key` : `Revoke the ${name} key`}
            </button>
            <button onClick={close} disabled={busy} className="rounded-md border border-line px-3 py-2 text-sm text-ink">
              Cancel
            </button>
          </div>
          {state && <p className="mt-2 text-xs text-body">{state}</p>}
          {mode === "revoke" && <p className="mt-2 text-[11px] text-muted">Takes effect at once. A revoked key can never be added again; add a new one afterwards.</p>}
        </div>
      )}
    </li>
  );
}
