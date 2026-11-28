"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { CreateAccount } from "@/components/account/Create";
import { Keys, useReader } from "@/components/account/Keys";
import { AccountActivity, AccountOverview, AccountPayees } from "@/components/account/OnChain";
import { Icon } from "@/components/argus/ui";
import { ProjectionBody, type ProjectionTab } from "@/components/console/Projection";
import { Mark } from "@/components/Logo";
import { ConnectButton } from "@/components/wallet/Wallet";
import { forgetAccount, parseDeployment, readAccount, saveAccount, savedAccounts, type AccountState, type Deployment } from "@/lib/account";
import type { ViewDocument } from "@/lib/view";
import { chainName, useWallet } from "@/lib/wallet";

/*
 * The console is your Tyrell account, nothing else:
 *  - on a self-hosted web app that proxies your control process, the full view (memories, lineage, decisions, incidents);
 *  - otherwise your account read straight from QIE (keys, payees, payments, activity);
 *  - with no account yet, create one from your wallet or open one you have.
 * The recorded demo run lives on the playground.
 */

type Tab = ProjectionTab | "keys" | "payees" | "activity";
type IconName = Parameters<typeof Icon>[0]["name"];
const FULL: Array<[Tab, string, IconName]> = [
  ["overview", "Overview", "pulse"],
  ["graph", "Lineage", "graph"],
  ["blast", "Blast radius", "shield"],
  ["decisions", "Decisions", "coin"],
  ["timeline", "Timeline", "list"],
  ["incidents", "Incidents", "flag"],
  ["keys", "Keys", "gear"],
];
const ACCOUNT: Array<[Tab, string, IconName]> = [
  ["overview", "Overview", "pulse"],
  ["payees", "Payees", "coin"],
  ["activity", "Activity", "list"],
  ["keys", "Keys", "gear"],
];

/** The full view, when this web server proxies a control process (TYRELL_API_URL, self-hosted). */
function useProjection() {
  const [view, setView] = useState<ViewDocument>();
  useEffect(() => {
    localStorage.removeItem("tyrell.control.url"); // a connection saved by an earlier version
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/view", { cache: "no-store" });
        const v = r.ok ? ((await r.json()) as ViewDocument) : undefined;
        if (alive) setView(v);
      } catch {
        if (alive) setView(undefined);
      }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return { view };
}

export default function Console() {
  const w = useWallet();
  const proj = useProjection();
  const [accounts, setAccounts] = useState<Deployment[]>([]);
  const [account, setAccount] = useState<Deployment>();
  const [screen, setScreen] = useState<"home" | "create" | "open">("home");
  const [tab, setTab] = useState<Tab>("overview");
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const all = savedAccounts();
    setAccounts(all);
    if (all.length === 1) setAccount(all[0]);
  }, []);
  // with several accounts, open the one on the wallet's network
  useEffect(() => {
    if (account || !w.chainId) return;
    const match = accounts.filter((a) => a.chainId === w.chainId && (!w.account || a.owner.toLowerCase() === w.account.toLowerCase()));
    if (match.length) setAccount(match[0]);
  }, [accounts, account, w.chainId, w.account]);

  const open = (d: Deployment) => {
    saveAccount(d);
    setAccounts(savedAccounts());
    setAccount(d);
    setScreen("home");
    setTab("overview");
  };
  const leave = () => {
    setAccount(undefined);
    setScreen("home");
  };

  const view = proj.view;
  const mode: "full" | "account" | "start" = view ? "full" : account && screen === "home" ? "account" : "start";
  const tabs = mode === "full" ? FULL : mode === "account" ? ACCOUNT : [];
  const current = tabs.find((t) => t[0] === tab) ? tab : "overview";
  const label = mode === "start" ? (screen === "create" ? "New account" : "Your account") : tabs.find((t) => t[0] === current)![1];
  const go = (t: Tab) => {
    setTab(t);
    setMenu(false);
  };

  const rail = (
    <nav className="flex flex-col items-center gap-1" aria-label="Console">
      {tabs.map(([t, l, icon]) => {
        const count = t === "incidents" && view ? view.incidents.length : 0;
        return (
          <button
            key={t}
            onClick={() => go(t)}
            aria-current={current === t ? "page" : undefined}
            className={`relative flex w-[60px] flex-col items-center gap-1 rounded-lg py-2 text-[10.5px] leading-none transition-colors ${current === t ? "bg-brand-50 text-brand" : "text-muted hover:bg-paper hover:text-ink"}`}
          >
            <Icon name={icon} />
            <span className="whitespace-nowrap">{l}</span>
            {count > 0 && <span className="mono absolute right-1.5 top-1 min-w-4 rounded-full bg-rose px-1 text-[9px] leading-4 text-white">{count}</span>}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className={`grid min-h-screen grid-cols-[minmax(0,1fr)] bg-[#f7f8fa] ${tabs.length ? "md:grid-cols-[76px_minmax(0,1fr)]" : ""}`}>
      {tabs.length > 0 && (
        <aside className="sticky top-0 hidden h-screen flex-col items-center gap-1 overflow-y-auto border-r border-line bg-white py-4 md:flex">
          <Link href="/" aria-label="Tyrell home" className="mb-4">
            <Mark size={28} />
          </Link>
          {rail}
        </aside>
      )}

      <main className="min-w-0">
        <header className="sticky top-0 z-10 border-b border-line bg-white/90 px-4 py-3 backdrop-blur-md sm:px-8 sm:py-4">
          <div className="flex items-center gap-2">
            {tabs.length > 0 ? (
              <button onClick={() => setMenu(true)} className="-ml-1.5 grid h-10 w-10 place-items-center rounded-lg text-ink hover:bg-paper md:hidden" aria-label="Open menu" aria-expanded={menu}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
            ) : (
              <Link href="/" aria-label="Tyrell home" className="mr-1">
                <Mark size={26} />
              </Link>
            )}
            <span className="text-lg font-medium text-ink">{label}</span>
            {mode === "account" && account && (
              <button onClick={leave} className="ml-2 hidden rounded-full border border-line px-2.5 py-0.5 text-[12px] text-body hover:bg-paper sm:block" title="Switch account">
                {chainName(account.chainId)} · {account.laneRegistry.slice(0, 6)}… ▾
              </button>
            )}
            <ConnectButton className="ml-auto hidden sm:flex" />
            <ConnectButton variant="icon" className="-mr-2 ml-auto sm:hidden" />
          </div>
        </header>

        {tabs.length > 0 && (
          <div className={`fixed inset-0 z-50 transition-[visibility] duration-300 md:hidden ${menu ? "visible" : "pointer-events-none invisible"}`}>
            <div onClick={() => setMenu(false)} className={`absolute inset-0 bg-ink/30 transition-opacity duration-300 ${menu ? "opacity-100" : "opacity-0"}`} />
            <div className={`absolute inset-y-0 left-0 flex w-[84px] flex-col items-center gap-1 overflow-y-auto border-r border-line bg-white pb-6 pt-4 shadow-xl transition-transform duration-300 ${menu ? "translate-x-0" : "-translate-x-full"}`}>
              <Link href="/" aria-label="Tyrell home" onClick={() => setMenu(false)} className="mb-4">
                <Mark size={28} />
              </Link>
              {rail}
              {mode === "account" && (
                <button onClick={leave} className="mt-4 w-[60px] rounded-lg py-2 text-[10.5px] text-muted hover:bg-paper">
                  Switch account
                </button>
              )}
            </div>
          </div>
        )}

        <div className="px-4 py-5 [overflow-wrap:anywhere] sm:px-8 sm:py-7">
          {mode === "full" && view && (current === "keys" ? <Keys chainId={view.chainId} memoryAnchor={view.contracts.memoryAnchor as Address} /> : <ProjectionBody view={view} tab={current as ProjectionTab} />)}
          {mode === "account" && account && <AccountScreen d={account} tab={current} onTab={go} />}
          {mode === "start" &&
            (screen === "create" ? (
              <CreateAccount onDone={open} onCancel={() => setScreen("home")} />
            ) : screen === "open" ? (
              <OpenAccount onOpen={open} onCancel={() => setScreen("home")} />
            ) : (
              <Start
                accounts={accounts}
                onPick={open}
                onForget={(d) => {
                  forgetAccount(d);
                  setAccounts(savedAccounts());
                }}
                onCreate={() => setScreen("create")}
                onOpen={() => setScreen("open")}
              />
            ))}
        </div>
      </main>
    </div>
  );
}

function AccountScreen({ d, tab, onTab }: { d: Deployment; tab: Tab; onTab: (t: Tab) => void }) {
  const w = useWallet();
  const reader = useReader(d.chainId);
  const [s, setS] = useState<AccountState>();
  const [err, setErr] = useState<string>();
  const load = useCallback(async () => {
    const c = reader();
    if (!c) return;
    try {
      setS(await readAccount(c, d));
      setErr(undefined);
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message);
    }
  }, [reader, d]);
  useEffect(() => {
    setS(undefined);
    void load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  if (tab === "keys") return <Keys chainId={d.chainId} laneRegistry={d.laneRegistry} />;
  if (!reader())
    return (
      <div className="rounded-xl border border-line bg-white p-5 text-[14px] text-body">
        This account is on {chainName(d.chainId)}. {w.account ? <button onClick={() => w.switchTo(d.chainId)} className="text-brand hover:underline">Switch your wallet to it</button> : "Connect your wallet on that network"} to read it.
      </div>
    );
  if (err) return <p className="rounded-xl border border-rose/30 bg-[#ffe9ed] p-4 text-[14px] text-rose">Could not read your account from {chainName(d.chainId)}: {err}</p>;
  if (!s) return <p className="text-muted">Reading your account from {chainName(d.chainId)}…</p>;
  if (tab === "payees") return <AccountPayees d={d} s={s} />;
  if (tab === "activity") return <AccountActivity d={d} s={s} />;
  return <AccountOverview d={d} s={s} onTab={onTab} />;
}

function Start({
  accounts,
  onPick,
  onForget,
  onCreate,
  onOpen,
}: {
  accounts: Deployment[];
  onPick: (d: Deployment) => void;
  onForget: (d: Deployment) => void;
  onCreate: () => void;
  onOpen: () => void;
}) {
  const w = useWallet();
  const mine = useMemo(() => accounts, [accounts]);
  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <div>
        <h1 className="text-[26px] font-medium tracking-[-0.01em] text-ink sm:text-[30px]">Your Tyrell account</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-body">Your keys, approved payees, payments and memory, owned by your wallet on QIE.</p>
      </div>

      {!w.account ? (
        <div className="rounded-2xl border border-line bg-white p-6">
          <p className="text-[15px] text-body">Connect the wallet that owns your account, or the one you want to own a new one.</p>
          <ConnectButton className="mt-4" />
          <p className="mt-5 text-[13px] text-muted">
            Just looking around?{" "}
            <Link href="/playground" className="text-brand hover:underline">
              Try the playground
            </Link>
            : it runs a full attack with no wallet.
          </p>
        </div>
      ) : (
        <>
          {mine.length > 0 && (
            <div className="rounded-2xl border border-line bg-white p-5">
              <div className="text-[13px] font-medium text-ink">Accounts opened in this browser</div>
              <ul className="mt-2 divide-y divide-line">
                {mine.map((d) => (
                  <li key={`${d.chainId}:${d.laneRegistry}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[14px]">
                    <button onClick={() => onPick(d)} className="font-medium text-brand hover:underline">
                      {chainName(d.chainId)} · {d.laneRegistry.slice(0, 8)}…
                    </button>
                    <span className="text-[12px] text-muted">owner {d.owner.slice(0, 6)}…{d.owner.slice(-4)}</span>
                    <button onClick={() => onForget(d)} className="ml-auto text-[12px] text-muted hover:text-rose">
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={onCreate} className="rounded-2xl border border-brand/40 bg-white p-5 text-left transition-colors hover:bg-brand-50">
              <div className="text-[16px] font-medium text-ink">Create a new account</div>
              <p className="mt-1 text-[13px] leading-relaxed text-body">Your wallet creates the contracts and registers your keys. About a minute.</p>
            </button>
            <button onClick={onOpen} className="rounded-2xl border border-line bg-white p-5 text-left transition-colors hover:border-brand/40">
              <div className="text-[16px] font-medium text-ink">Open an account I have</div>
              <p className="mt-1 text-[13px] leading-relaxed text-body">Use your account file, or the deployment file from <span className="mono">tyrell deploy</span>.</p>
            </button>
          </div>
        </>
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
    <div className="mx-auto max-w-[640px] rounded-2xl border border-line bg-white p-5 sm:p-7">
      <h2 className="text-[22px] font-medium tracking-[-0.01em] text-ink">Open an account</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-body">
        Choose your account file (<span className="mono">tyrell-account-….json</span>) or a deployment file (<span className="mono">~/.tyrell/deployment-….json</span>). Only the contract addresses are read; keys stay in the file.
      </p>
      <label className="mt-5 block rounded-xl border border-dashed border-line px-4 py-6 text-center text-[14px] text-body hover:border-brand/50">
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
      <div className="mt-4 text-[13px] text-muted">or paste it:</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} aria-label="Deployment JSON" className="mono mt-1 w-full rounded-lg border border-line px-3 py-2 text-[12px] text-ink outline-none focus:border-brand" />
      {err && <p className="mt-2 rounded-lg bg-[#ffe9ed] px-3 py-2 text-[13px] text-rose">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={() => use(text)} disabled={!text.trim()} className="rounded-xl bg-brand px-5 py-2.5 text-[15px] font-medium text-white disabled:opacity-50">
          Open
        </button>
        <button onClick={onCancel} className="rounded-xl border border-line px-5 py-2.5 text-[15px] text-ink hover:bg-paper">
          Back
        </button>
      </div>
    </div>
  );
}
