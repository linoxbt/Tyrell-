"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, http, isAddressEqual, zeroAddress, type Address, type PublicClient } from "viem";
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
  const publicRpc = CHAINS[target] && target !== 31337 ? CHAINS[target]!.rpcUrls[0] : undefined;

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
  const role = !w.account ? undefined : isOwner ? "Owner" : r?.mine ? `${LANES.find((l) => l[0] === r.mine!.lane)?.[1]} lane key${r.mine.active ? "" : " (revoked)"}` : "Viewer";

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

        {w.account && !sameChain && (
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
        {!r && !err && <p className="text-sm text-muted">{client() ? "Reading…" : "Connect a wallet to see the keys."}</p>}
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

function KeyRow({ lane, name, what, keyAddr, canRevoke, registry, onDone }: { lane: number; name: string; what: string; keyAddr: Address; canRevoke: boolean; registry: Address; onDone: () => void }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("suspected compromise");
  const [state, setState] = useState<string>();
  const none = isAddressEqual(keyAddr, zeroAddress);

  const revoke = async () => {
    if (!w.wallet || !w.account) return;
    setState("Confirm in your wallet…");
    try {
      const wc = createWalletClient({ account: w.account, transport: custom(w.wallet.provider) });
      const hash = await wc.writeContract({ address: registry, abi: registryAbi, functionName: "revokeLaneKey", args: [keyAddr, reason], chain: null });
      setState("Waiting for the block…");
      await createPublicClient({ transport: custom(w.wallet.provider) }).waitForTransactionReceipt({ hash });
      setState(undefined);
      setOpen(false);
      onDone();
    } catch (e) {
      const x = e as { code?: number; shortMessage?: string };
      setState(x.code === 4001 ? "Cancelled in the wallet." : (x.shortMessage ?? String(e)));
    }
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-16 text-sm font-medium text-ink">{name}</span>
        <span className={`mono text-[13px] ${none ? "text-muted" : "text-body"}`}>{none ? "no active key" : short(keyAddr)}</span>
        {canRevoke && !none && (
          <button onClick={() => setOpen((o) => !o)} className="ml-auto rounded-md border border-rose/40 px-2.5 py-1 text-xs text-rose transition-colors hover:bg-[#ffe9ed]">
            {open ? "Cancel" : "Revoke"}
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted">{what}</p>
      {open && (
        <div className="mt-3 rounded-lg border border-rose/30 bg-[#fff7f8] p-3">
          <label className="block text-xs text-body">
            Reason (on-chain)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand" />
          </label>
          <button onClick={revoke} disabled={!reason || !!state?.startsWith("Confirm") || !!state?.startsWith("Waiting")} className="mt-2 w-full rounded-md bg-rose py-2 text-sm text-white transition-opacity disabled:opacity-60">
            Revoke the {name} key
          </button>
          {state && <p className="mt-2 text-xs text-body">{state}</p>}
          <p className="mt-2 text-[11px] text-muted">Permanent: a revoked key can never be re-added.</p>
        </div>
      )}
    </li>
  );
}
