"use client";

import { useState } from "react";
import type { Address, Hex } from "viem";
import { CREATE_STEPS, createAccount, saveAccount, type Deployment, type NewAccountKeys } from "@/lib/account";
import { createKey, download, type KeystoreV3, type Role } from "@/lib/keystore";
import { CHAINS, chainName, useWallet } from "@/lib/wallet";

/*
 * Create a Tyrell account from the connected wallet:
 *  1. the browser makes the seven keys the Tyrell processes use, encrypted with the owner's password;
 *  2. the wallet creates the four contracts (and a test token off mainnet) and registers the lane keys;
 *  3. the account file (keys + addresses) downloads, ready for `pnpm tyrell import`.
 */

const ROLES: Role[] = ["user", "agent", "wallet", "control", "submitter", "signer", "data"];
const SUPPORTED = [1983, 1990, 31337];

export function CreateAccount({ onDone, onCancel }: { onDone: (d: Deployment) => void; onCancel: () => void }) {
  const w = useWallet();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [phase, setPhase] = useState<"form" | "keys" | "chain" | "done">("form");
  const [steps, setSteps] = useState<Array<{ label: string; state: "todo" | "wait" | "done"; hash?: Hex }>>([]);
  const [err, setErr] = useState<string>();
  const [made, setMade] = useState<Deployment>();
  const chainId = w.chainId ?? 0;
  const ok = SUPPORTED.includes(chainId);
  const mainnet = chainId === 1990;
  const fileName = `tyrell-account-${chainId}.json`;

  async function start() {
    if (!w.wallet || !w.account) return;
    setErr(undefined);
    if (pw.length < 8) return setErr("The password must be at least 8 characters.");
    if (pw !== pw2) return setErr("The two passwords differ.");
    const owner = w.account;
    const provider = w.wallet.provider;
    try {
      setPhase("keys");
      const keystores: Partial<Record<Role, KeystoreV3>> = {};
      const addresses: Partial<Record<Role, Address>> = {};
      for (const role of ROLES) {
        const k = await createKey(role, pw);
        keystores[role] = k.keystore;
        if (k.address) addresses[role] = k.address;
      }
      setPhase("chain");
      setSteps(CREATE_STEPS(mainnet).map((label) => ({ label, state: "todo" })));
      const d = await createAccount(provider, owner, chainId, addresses as NewAccountKeys, (s) => setSteps((all) => all.map((x, i) => (i === s.i ? { ...x, state: s.state, ...(s.hash ? { hash: s.hash } : {}) } : x))));
      saveAccount(d);
      download(fileName, { tyrell: "account-v1", network: mainnet ? "mainnet" : chainId === 1983 ? "testnet" : "local", chainId, acct: d.acct, deployment: d, addresses, keys: keystores });
      setMade(d);
      setPhase("done");
    } catch (e) {
      const x = e as { code?: number; shortMessage?: string; message?: string };
      setErr(x.code === 4001 ? "Cancelled in the wallet. Nothing more was sent; start again when you are ready." : (x.shortMessage ?? x.message ?? String(e)));
      setPhase("form");
    }
  }

  const field = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-brand";
  return (
    <div className="mx-auto max-w-[640px] rounded-2xl border border-line bg-white p-5 sm:p-7">
      <h2 className="text-[22px] font-medium tracking-[-0.01em] text-ink">Create your Tyrell account</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-body">
        Your wallet becomes the owner. Tyrell&apos;s contracts are created on {chainName(chainId)} and only your wallet can change them.
      </p>

      {phase === "form" && (
        <div className="mt-6 space-y-5">
          <div>
            <div className="text-[13px] font-medium text-ink">Network</div>
            {ok ? (
              <p className="mt-1 text-[14px] text-body">
                {chainName(chainId)}
                {mainnet ? " · real money: uses QUSDC" : " · test money: a test token is created for your vault"}
              </p>
            ) : (
              <p className="mt-1 text-[14px] text-rose">Your wallet is on {chainName(chainId)}. Switch to QIE Testnet to try it, or QIE Mainnet.</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {[1983, 1990].map((id) => (
                <button key={id} onClick={() => w.switchTo(id)} disabled={chainId === id} className={`rounded-lg border px-3 py-1.5 text-sm ${chainId === id ? "border-brand bg-brand-50 text-brand" : "border-line text-ink hover:bg-paper"}`}>
                  {CHAINS[id]!.name}
                  {id === 1983 ? " (try it free)" : ""}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[13px] font-medium text-ink">A password for your keys</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">Tyrell runs as a few small programs on your computer, each with its own key. Your browser makes those keys now and encrypts them with this password. It is not sent anywhere.</p>
            <label className="mt-2 block text-[13px] text-body">
              Password (8 characters or more)
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={field} />
            </label>
            <label className="mt-2 block text-[13px] text-body">
              Same password again
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={field} />
            </label>
          </div>

          <div className="rounded-xl bg-paper p-4 text-[13px] leading-relaxed text-body">
            Your wallet will ask you to confirm <b className="font-medium text-ink">{CREATE_STEPS(mainnet).length} transactions</b>: {mainnet ? "four" : "five"} to create the contracts and four to register the keys. Each costs a little QIE for gas.
          </div>

          {err && <p className="rounded-lg bg-[#ffe9ed] px-3 py-2 text-[13px] text-rose">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={start} disabled={!ok || !pw || !pw2} className="rounded-xl bg-brand px-5 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-brand-deep disabled:opacity-50">
              Create my account
            </button>
            <button onClick={onCancel} className="rounded-xl border border-line px-5 py-2.5 text-[15px] text-ink hover:bg-paper">
              Back
            </button>
          </div>
        </div>
      )}

      {phase === "keys" && <p className="mt-6 text-[14px] text-body">Making your seven keys…</p>}

      {(phase === "chain" || phase === "done") && (
        <ol className="mt-6 space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-3 text-[14px]">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] ${s.state === "done" ? "bg-band-green text-white" : s.state === "wait" ? "bg-brand text-white" : "bg-paper text-muted"}`}>{s.state === "done" ? "✓" : i + 1}</span>
              <span className={s.state === "todo" ? "text-muted" : "text-ink"}>{s.label}</span>
              {s.state === "wait" && <span className="text-[12px] text-muted">confirm in your wallet…</span>}
            </li>
          ))}
        </ol>
      )}

      {phase === "done" && made && (
        <div className="mt-6 space-y-4">
          <p className="rounded-xl bg-[#e6f7f0] px-4 py-3 text-[14px] text-band-green">Your account is ready. Your account file downloaded as {fileName}.</p>
          <div className="text-[14px] leading-relaxed text-body">
            <div className="font-medium text-ink">Next, on the computer that will run Tyrell:</div>
            <pre className="mono mt-2 overflow-x-auto rounded-lg bg-night p-3 text-[12px] text-snow">{`git clone https://github.com/linoxbt/Tyrell- && cd Tyrell- && pnpm install
pnpm tyrell import ~/Downloads/${fileName}
pnpm tyrell control start`}</pre>
            <p className="mt-2 text-[13px] text-muted">The import asks for the password you just chose. Keep the account file safe: it holds your keys (encrypted).</p>
          </div>
          <button onClick={() => onDone(made)} className="rounded-xl bg-brand px-5 py-2.5 text-[15px] font-medium text-white hover:bg-brand-deep">
            Open my account
          </button>
        </div>
      )}
    </div>
  );
}
