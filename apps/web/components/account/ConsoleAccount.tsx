"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEther, type Address } from "viem";
import { abi, chainView, forgetAccount, parseDeployment, saveAccount, savedAccounts, type Deployment } from "@/lib/account";
import type { ViewDocument } from "@/lib/view";
import { CHAINS, chainName, useWallet } from "@/lib/wallet";
import { ConnectButton } from "../wallet/Wallet";
import { CreateAccount } from "./Create";
import { Keys, useReader } from "./Keys";

/*
 * Where the console's data comes from, and the Account tab. The console renders one view document:
 * from a control process the web server proxies (TYRELL_API_URL), or else built from your account's
 * contracts on QIE. With no account yet, it offers to create or open one.
 */

export function useConsoleView() {
  const w = useWallet();
  const [accounts, setAccounts] = useState<Deployment[]>([]);
  const [account, setAccount] = useState<Deployment>();
  const [screen, setScreen] = useState<"start" | "create" | "open">("start");
  const [view, setView] = useState<ViewDocument>();
  const [error, setError] = useState("");
  const reader = useReader(account?.chainId ?? 0);

  useEffect(() => {
    localStorage.removeItem("tyrell.control.url"); // saved by an earlier version
    const all = savedAccounts();
    setAccounts(all);
    if (all.length === 1) setAccount(all[0]);
  }, []);
  useEffect(() => {
    if (account || !w.chainId) return;
    const match = accounts.filter((a) => a.chainId === w.chainId && (!w.account || a.owner.toLowerCase() === w.account.toLowerCase()));
    if (match.length) setAccount(match[0]);
  }, [accounts, account, w.chainId, w.account]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/view", { cache: "no-store" });
      if (r.ok) {
        setView((await r.json()) as ViewDocument);
        setError("");
        return;
      }
    } catch {
      /* no proxied control process */
    }
    if (!account) return setView(undefined);
    const c = reader();
    if (!c) {
      setView(undefined);
      setError(`This account is on ${chainName(account.chainId)}. Switch your wallet to it to read it.`);
      return;
    }
    try {
      setView(await chainView(c, account, chainName(account.chainId), CHAINS[account.chainId]?.explorer));
      setError("");
    } catch (e) {
      setError(`Could not read your account from ${chainName(account.chainId)}: ${(e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message}`);
    }
  }, [account, reader]);

  useEffect(() => {
    setView(undefined);
    setError("");
    void load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  return {
    view,
    error,
    account,
    accounts,
    screen,
    setScreen,
    open: (d: Deployment) => {
      saveAccount(d);
      setAccounts(savedAccounts());
      setAccount(d);
      setScreen("start");
    },
    forget: (d: Deployment) => {
      forgetAccount(d);
      setAccounts(savedAccounts());
      if (account === d) setAccount(undefined);
    },
    leave: () => {
      setAccount(undefined);
      setView(undefined);
      setScreen("start");
    },
  };
}
export type ConsoleAccount = ReturnType<typeof useConsoleView>;

const panel = "rounded-xl border border-line bg-white p-5";
const title = "mono mb-3 text-[12px] uppercase tracking-wider text-muted";

/** No account yet: create or open one, in the console's own panels. */
export function AccountStart({ acc }: { acc: ConsoleAccount }) {
  const w = useWallet();
  if (acc.screen === "create") return <CreateAccount onDone={acc.open} onCancel={() => acc.setScreen("start")} />;
  if (acc.screen === "open") return <OpenAccount onOpen={acc.open} onCancel={() => acc.setScreen("start")} />;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section className={panel}>
        <h3 className={title}>Your account</h3>
        {!w.account ? (
          <>
            <p className="text-sm text-body">Connect the wallet that owns your Tyrell account, or the one that should own a new one.</p>
            <ConnectButton className="mt-4" />
          </>
        ) : acc.accounts.length ? (
          <ul className="divide-y divide-line">
            {acc.accounts.map((d) => (
              <li key={`${d.chainId}:${d.laneRegistry}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <button onClick={() => acc.open(d)} className="font-medium text-brand hover:underline">
                  {chainName(d.chainId)} · {d.laneRegistry.slice(0, 8)}…
                </button>
                <span className="text-xs text-muted">owner {d.owner.slice(0, 6)}…{d.owner.slice(-4)}</span>
                <button onClick={() => acc.forget(d)} className="ml-auto text-xs text-muted hover:text-rose">
                  Forget
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-body">No account opened in this browser yet.</p>
        )}
      </section>
      {w.account && (
        <section className={panel}>
          <h3 className={title}>Get started</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={() => acc.setScreen("create")} className="rounded-xl border border-brand/40 p-4 text-left transition-colors hover:bg-brand-50">
              <div className="text-[15px] font-medium text-ink">Create a new account</div>
              <p className="mt-1 text-[13px] leading-relaxed text-body">Your wallet creates the contracts and registers your keys.</p>
            </button>
            <button onClick={() => acc.setScreen("open")} className="rounded-xl border border-line p-4 text-left transition-colors hover:border-brand/40">
              <div className="text-[15px] font-medium text-ink">Open an account I have</div>
              <p className="mt-1 text-[13px] leading-relaxed text-body">From your account file or a deployment file.</p>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function OpenAccount({ onOpen, onCancel }: { onOpen: (d: Deployment) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string>();
  const use = (t: string) => {
    try {
      onOpen(parseDeployment(t));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <section className={`${panel} max-w-[720px]`}>
      <h3 className={title}>Open an account</h3>
      <p className="text-sm leading-relaxed text-body">
        Choose your account file (<span className="mono">tyrell-account-….json</span>) or a deployment file (<span className="mono">~/.tyrell/deployment-….json</span>). Only the contract addresses are read.
      </p>
      <label className="mt-4 block cursor-pointer rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-body hover:border-brand/50">
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) use(await f.text());
          }}
        />
        Choose a file
      </label>
      <div className="mt-3 text-xs text-muted">or paste it:</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label="Deployment JSON" className="mono mt-1 w-full rounded-lg border border-line px-3 py-2 text-[12px] text-ink outline-none focus:border-brand" />
      {err && <p className="mt-2 rounded-lg bg-[#ffe9ed] px-3 py-2 text-[13px] text-rose">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={() => use(text)} disabled={!text.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm text-white disabled:opacity-50">
          Open
        </button>
        <button onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-paper">
          Back
        </button>
      </div>
    </section>
  );
}

/** The Account tab: your wallet and the lane keys (as before), then this account's contracts and gas. */
export function AccountTab({ acc, view }: { acc: ConsoleAccount; view: ViewDocument }) {
  const d = acc.account;
  const reader = useReader(view.chainId);
  const [gas, setGas] = useState<Array<{ name: string; address: Address; balance: bigint }>>([]);
  useEffect(() => {
    const c = reader();
    if (!c || !d) return;
    void (async () => {
      const submitter = (await c.readContract({ address: d.memoryAnchor, abi: abi("MemoryAnchor"), functionName: "submitter" })) as Address;
      const keys = [{ name: "submitter", address: submitter }, ...(d.signer ? [{ name: "signer", address: d.signer }] : [])];
      setGas(await Promise.all(keys.map(async (k) => ({ ...k, balance: await c.getBalance({ address: k.address }) }))));
    })().catch(() => undefined);
  }, [reader, d]);
  const explorer = CHAINS[view.chainId]?.explorer;
  return (
    <div className="space-y-5">
      <Keys chainId={view.chainId} memoryAnchor={view.contracts.memoryAnchor as Address} />
      {d && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <section className={panel}>
            <h3 className={title}>Gas for your keys</h3>
            {gas.length === 0 ? (
              <p className="text-sm text-muted">Reading…</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {gas.map((g) => (
                  <li key={g.name} className="flex flex-wrap items-center gap-x-3">
                    <span className="w-20 font-medium text-ink">{g.name}</span>
                    <span className="mono text-[13px] text-body">{`${g.address.slice(0, 6)}…${g.address.slice(-4)}`}</span>
                    <span className={`ml-auto text-[13px] ${g.balance === 0n ? "text-amber" : "text-band-green"}`}>{g.balance === 0n ? "needs QIE" : `${Number(formatEther(g.balance)).toFixed(4)} QIE`}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">The submitter pays to record memories and the signer to execute payments. Send each a little QIE.</p>
          </section>
          <section className={panel}>
            <h3 className={title}>This account</h3>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
              {(
                [
                  ["Network", chainName(d.chainId)],
                  ["Owner", d.owner],
                  ["Key registry", d.laneRegistry],
                  ["Memory log", d.memoryAnchor],
                  ["Payee ledger", d.tyrellLedger],
                  ["Vault", d.guardedVault],
                  ["Token", d.token],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="mono truncate text-ink">
                    {v.startsWith("0x") && explorer ? (
                      <a href={`${explorer}/address/${v}`} target="_blank" rel="noreferrer" className="hover:text-brand">
                        {v}
                      </a>
                    ) : (
                      v
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex gap-2">
              <button onClick={acc.leave} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-paper">
                Switch account
              </button>
              <button onClick={() => acc.forget(d)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-rose">
                Forget in this browser
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
