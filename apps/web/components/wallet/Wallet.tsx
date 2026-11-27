"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CHAINS, QIE_WALLET_RDNS, QIE_WALLET_URL, chainName, useWallet, type DetectedWallet } from "@/lib/wallet";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** A deterministic two-colour avatar from the address, so the same wallet always looks the same. */
export function Avatar({ address, size = 22 }: { address: string; size?: number }) {
  const h = parseInt(address.slice(2, 8), 16);
  const a = h % 360;
  const b = (a + 40 + (h >> 8) % 80) % 360;
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: `conic-gradient(from ${h % 360}deg, hsl(${a} 85% 62%), hsl(${b} 80% 55%), hsl(${a} 85% 62%))` }} />;
}

function WalletIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-5 w-5 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3M4 7.5A1.5 1.5 0 0 0 5.5 9H19a1 1 0 0 1 1 1v2" />
      <path d="M20 12h-3.5a1.5 1.5 0 0 0 0 3H20z" />
    </svg>
  );
}

/** The wallet entry point. `full` for headers with room, `icon` for phones. */
export function ConnectButton({ variant = "full", className = "" }: { variant?: "full" | "icon"; className?: string }) {
  const { account, session, openSheet } = useWallet();
  if (variant === "icon")
    return (
      <button onClick={openSheet} aria-label={account ? `Wallet ${short(account)}` : "Connect wallet"} className={`relative grid h-10 w-10 place-items-center rounded-lg text-ink transition-colors hover:bg-paper ${className}`}>
        {account ? <Avatar address={account} size={22} /> : <WalletIcon />}
        {account && <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-white ${session ? "bg-band-green" : "bg-amber"}`} />}
      </button>
    );
  return account ? (
    <button onClick={openSheet} className={`flex items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-white py-2 pl-2 pr-3 text-[15px] text-ink transition-colors hover:bg-paper ${className}`}>
      <Avatar address={account} />
      <span className="mono text-[13px]">{short(account)}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${session ? "bg-band-green" : "bg-amber"}`} title={session ? "Signed in" : "Connected, not signed in"} />
    </button>
  ) : (
    <button onClick={openSheet} className={`flex items-center gap-2 whitespace-nowrap rounded-lg border border-brand px-4 py-2.5 text-[15px] leading-none text-brand transition-[background-color,transform] duration-200 hover:bg-brand-50 active:scale-[0.98] ${className}`}>
      <WalletIcon className="h-4 w-4" /> Connect wallet
    </button>
  );
}

/** The connect / sign-in sheet: a bottom sheet on phones, a centred dialog from sm up. */
export function WalletSheet() {
  const w = useWallet();
  const { sheetOpen, closeSheet } = w;

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSheet();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [sheetOpen, closeSheet]);

  return (
    <div className={`fixed inset-0 z-[60] transition-[visibility] duration-300 ${sheetOpen ? "visible" : "pointer-events-none invisible"}`} aria-hidden={!sheetOpen}>
      <div onClick={closeSheet} className={`absolute inset-0 bg-ink/40 backdrop-blur-[2px] transition-opacity duration-300 ${sheetOpen ? "opacity-100" : "opacity-0"}`} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Wallet"
        className={`absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[24px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-20px_60px_rgba(15,18,32,0.25)] transition-transform duration-300 ease-out sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[420px] sm:rounded-[24px] sm:p-6 sm:transition-[transform,opacity] ${
          sheetOpen ? "translate-y-0 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:opacity-100" : "translate-y-full sm:-translate-x-1/2 sm:-translate-y-[46%] sm:opacity-0"
        }`}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        <div className="flex items-start">
          <div>
            <h2 className="text-[20px] font-medium tracking-[-0.01em] text-ink">{w.account ? (w.session ? "Your wallet" : "Sign in") : "Connect a wallet"}</h2>
            <p className="mt-1 text-sm text-body">
              {w.account
                ? w.session
                  ? "Signed in. On-chain actions still ask your wallet each time."
                  : "Sign a message to prove this is your wallet. It is not a transaction and costs nothing."
                : "Your QIE Wallet is your Tyrell owner key: it registers your agent's keys and can revoke them."}
            </p>
          </div>
          <button onClick={closeSheet} aria-label="Close" className="-mr-1 -mt-1 ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-paper hover:text-ink">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {!w.account ? <Pick /> : <Account />}

        {w.error && <p className="mt-4 rounded-xl border border-rose/30 bg-[#ffe9ed] px-3.5 py-2.5 text-[13px] text-rose">{w.error}</p>}
      </div>
    </div>
  );
}

function Pick() {
  const { wallets, ready, connect, busy } = useWallet();
  const hasQie = wallets.some((x) => x.rdns === QIE_WALLET_RDNS);
  return (
    <div className="mt-5 space-y-2">
      {wallets.map((x) => (
        <WalletRow key={x.rdns} w={x} onClick={() => connect(x)} disabled={busy === "connecting"} />
      ))}
      {ready && !hasQie && (
        <a href={QIE_WALLET_URL} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 transition-colors hover:bg-paper">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/qie-wallet.png" alt="" className="h-9 w-9 rounded-lg" />
          <span className="min-w-0">
            <span className="block text-[15px] text-ink">QIE Wallet</span>
            <span className="block text-xs text-muted">Not detected. Get the extension or app</span>
          </span>
          <span className="ml-auto shrink-0 whitespace-nowrap text-sm text-brand">Get it ↗</span>
        </a>
      )}
      {ready && wallets.length === 0 && (
        <p className="rounded-xl bg-paper px-4 py-3 text-[13px] leading-relaxed text-body">
          No wallet found in this browser. On a phone, open this page from the browser inside the QIE Wallet app. On a computer, install the QIE Wallet extension and reload.
        </p>
      )}
      {!ready && <p className="py-3 text-center text-sm text-muted">Looking for wallets…</p>}
      <p className="pt-2 text-center text-xs text-muted">Connecting shares only your address. Tyrell never asks for your seed phrase.</p>
    </div>
  );
}

function WalletRow({ w, onClick, disabled }: { w: DetectedWallet; onClick: () => void; disabled?: boolean }) {
  const qie = w.rdns === QIE_WALLET_RDNS;
  return (
    <button onClick={onClick} disabled={disabled} className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-60 ${qie ? "border-brand/40 bg-brand-50/60 hover:bg-brand-50" : "border-line hover:bg-paper"}`}>
      {w.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={w.icon} alt="" className="h-9 w-9 rounded-lg" />
      ) : (
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-paper text-muted">
          <WalletIcon />
        </span>
      )}
      <span className="text-[15px] text-ink">{w.name}</span>
      {qie && <span className="ml-auto rounded-full bg-brand px-2 py-0.5 text-[11px] text-white">Recommended</span>}
    </button>
  );
}

function Account() {
  const { account, chainId, session, signIn, switchTo, disconnect, busy, wallet, closeSheet, manage, mode } = useWallet();
  if (!account) return null;
  const onQie = chainId === 1990 || chainId === 1983;
  return (
    <div className="mt-5">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3.5">
        <Avatar address={account} size={36} />
        <div className="min-w-0">
          <div className="mono truncate text-[14px] text-ink">{short(account)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>{wallet?.name}</span>
            <span>·</span>
            <span className={onQie ? "text-band-green" : "text-[#b26a00]"}>{chainName(chainId)}</span>
          </div>
        </div>
        <span className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${session ? "bg-[#e6f7f0] text-band-green" : "bg-tint-peach text-[#b26a00]"}`}>{session ? "Signed in" : "Not signed in"}</span>
      </div>

      {!session && (
        <button onClick={signIn} disabled={busy === "signing"} className="mt-4 w-full rounded-xl bg-brand py-3.5 text-[15px] text-white transition-[background-color,transform] duration-200 hover:bg-brand-deep active:scale-[0.99] disabled:opacity-60">
          {busy === "signing" ? "Check your wallet…" : "Sign in with your wallet"}
        </button>
      )}

      {!onQie && (
        <div className="mt-4">
          <p className="text-[13px] text-body">Tyrell runs on QIE. Switch your wallet&apos;s network:</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[1990, 1983].map((id) => (
              <button key={id} onClick={() => switchTo(id)} disabled={busy === "switching"} className="rounded-xl border border-line py-2.5 text-sm text-ink transition-colors hover:bg-paper disabled:opacity-60">
                {CHAINS[id]!.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link href="/console" onClick={closeSheet} className="rounded-xl border border-line py-2.5 text-center text-sm text-ink transition-colors hover:bg-paper">
          Open console
        </Link>
        <Link href="/start" onClick={closeSheet} className="rounded-xl border border-line py-2.5 text-center text-sm text-ink transition-colors hover:bg-paper">
          Get started
        </Link>
      </div>
      <div className="mt-3 flex items-center justify-center gap-6">
        {manage && (
          <button onClick={manage} className="py-2 text-sm text-muted transition-colors hover:text-ink">
            Wallet details
          </button>
        )}
        <button onClick={disconnect} className="py-2 text-sm text-muted transition-colors hover:text-rose">
          Disconnect
        </button>
      </div>
      {mode === "reown" && <p className="mt-1 text-center text-[11px] text-muted">Connected with Reown · WalletConnect</p>}
    </div>
  );
}
