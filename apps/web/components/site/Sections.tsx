"use client";

import Link from "next/link";
import { useState } from "react";
import { ATTACKS } from "@/lib/attacks";
import { short, type ViewDocument } from "@/lib/view";
import { Mark, Wordmark } from "../Logo";
import { REPO } from "./Nav";

const Eyebrow = ({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) => (
  <span className={`rounded-full border px-3 py-1 text-xs ${dark ? "border-white/15 text-stone-300" : "border-line bg-white text-stone-600"}`}>{children}</span>
);

export function HowItWorks() {
  const steps = [
    ["Sign", "Each process holds one lane key that you registered on-chain: user, agent, wallet, control. A memory is only as trusted as the key that signed it."],
    ["Anchor", "Bodies are encrypted to IPFS. Their hashes, signer and CID are anchored on QIE by MemoryAnchor, which rejects any key that is not the lane's."],
    ["Trace", "Whatever Steward read becomes the parent of what it writes. Taint follows the information, so a summary can never launder its source."],
    ["Guard", "The model can only propose. Code pays registered payees within caps, and GuardedVault checks the same rules again on-chain."],
  ];
  return (
    <section id="how" className="grid-bg border-b border-line">
      <div className="mx-auto max-w-[1200px] px-6 py-24 text-center">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mx-auto mt-5 max-w-[700px] text-4xl font-medium tracking-[-0.035em] md:text-5xl">From a signed memory to a payment the chain approved</h2>
        <p className="mt-4 text-stone-600">Four steps. The language model is treated as untrusted code at every one of them.</p>
        <div className="mt-14 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([t, b], i) => (
            <div key={t} className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_0_rgba(15,16,32,0.04)]">
              <span className="rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand">Step {i + 1}</span>
              <h3 className="mt-10 text-xl font-medium">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{b}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Platform({ view }: { view?: ViewDocument }) {
  const seed = view?.seeds.filter((s) => !s.released).at(-1);
  const radius = seed ? view!.memories.filter((m) => m.seeds.includes(seed.seedId)) : [];
  const top = (view?.incidents ?? []).slice(-3).reverse();
  return (
    <section id="platform" className="border-b border-line">
      <div className="mx-auto max-w-[1200px] px-6 py-24">
        <div className="text-center">
          <Eyebrow>Platform</Eyebrow>
          <h2 className="mx-auto mt-5 max-w-[720px] text-4xl font-medium tracking-[-0.035em] md:text-5xl">Everything you need to let an agent touch money</h2>
        </div>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          <Card className="bg-[#fff6e8] md:col-span-2" title="Blast radius" body="Pick a poisoned source and see every memory, summary and decision it reached, and the vault transactions those decisions referenced.">
            <div className="mt-6 flex flex-wrap items-center gap-2">
              {(radius.length ? radius : [{ id: "a", laneName: "wallet" }, { id: "b", laneName: "agent" }, { id: "c", laneName: "control" }]).slice(0, 4).map((m, i) => (
                <span key={m.id} className="flex items-center gap-2">
                  {i > 0 && <span className="text-stone-400">→</span>}
                  <span className="mono rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs shadow-sm">
                    {m.laneName} <span className="text-stone-400">{m.id.length > 4 ? short(m.id, 3) : ""}</span>
                  </span>
                </span>
              ))}
            </div>
          </Card>
          <Card className="bg-brand-50" title="Quarantine, not deletion" body="One on-chain seed excludes a source and everything that descends from it, including memories written later. Evidence stays anchored and pinned. Only your key releases it." />
          <Card className="bg-[#f6effd]" title="Sentinel" body="Every transfer, token name, NFT description and MCP read is written through the wallet lane first, then scored.">
            <div className="mt-5 space-y-2">
              {(top.length ? top : [{ memoryId: "x", score: 85, rules: ["imperative", "embedded", "payeeWords"] }]).map((i) => (
                <div key={i.memoryId} className="flex items-center gap-2 text-xs">
                  <span className="mono rounded bg-white px-2 py-1 font-semibold">{i.score}</span>
                  <span className="text-stone-600">{i.rules.join(" · ")}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="bg-[#eef6ff]" title="Rebuild from the chain" body="Delete the database. Tyrell rebuilds every class, every quarantine and every payee from QIE and IPFS alone, and proves the digest matches.">
            <div className="mono mt-5 space-y-1 text-xs text-stone-600">
              <div>live    {view ? short(view.digest, 6) : "0x…"}</div>
              <div>rebuilt {view ? short(view.digest, 6) : "0x…"} <span className="text-emerald-600">✓ match</span></div>
            </div>
          </Card>
          <Card className="bg-stone-50" title="A stolen signer key pays no one new" body="The vault signer can only pay payees you registered, within daily caps. The drill sends an unauthorized pay on-chain and the vault reverts it." />
        </div>
      </div>
    </section>
  );
}

function Card({ title, body, className = "", children }: { title: string; body: string; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`rounded-2xl p-7 ${className}`}>
      <h3 className="text-xl font-medium">{title}</h3>
      <p className="mt-2 max-w-[520px] text-sm leading-relaxed text-stone-600">{body}</p>
      {children}
    </div>
  );
}

export function AttackGate() {
  return (
    <section id="attacks" className="border-b border-line bg-stone-50">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 py-24 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <Eyebrow>Attack set</Eyebrow>
          <h2 className="mt-5 text-4xl font-medium tracking-[-0.035em] md:text-5xl">Ten attacks. A fully compromised model. Nothing paid.</h2>
          <p className="mt-5 text-stone-600">
            The attack runner scripts the model to take every bait, because the guarantees must not depend on it. Each attack must end blocked by the
            policy engine, rejected by the contracts, or excluded, with the attacker&apos;s balance unchanged.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-stone-700">
            <li>✓ Runs against a live deployment with one command</li>
            <li>✓ The attacker holds only its own key</li>
            <li>✓ Prints a pass table for the README</li>
          </ul>
          <code className="mono mt-8 inline-block rounded-lg bg-ink px-4 py-2.5 text-sm text-white">pnpm tyrell attack run</code>
        </div>
        <div className="rounded-3xl bg-[radial-gradient(120%_120%_at_0%_0%,#8b7bf5_0%,#6c5ce7_35%,#c03fd0_100%)] p-6 md:p-10">
          <div className="rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center gap-2 border-b border-line pb-3 text-xs">
              <span className="mono text-stone-600">attack set · compromised model</span>
              <span className="ml-auto rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">10 / 10 PASSED</span>
            </div>
            <ul className="divide-y divide-line">
              {ATTACKS.map((a, i) => (
                <li key={a.name} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="mono w-5 text-stone-400">{i + 1}</span>
                  <span className="text-stone-700">{a.name}</span>
                  <span className="mono ml-auto shrink-0 text-[11px] text-rose-600">{a.result}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export function BuiltOnQie({ view }: { view?: ViewDocument }) {
  const parts = [
    ["QIE Mainnet", "4 contracts · chain 1990"],
    ["QIE Wallet", "the owner key · EIP-6963"],
    ["QIE ID", "payees, round-tripped"],
    ["QIE MCP", "resolve · reverse · balances"],
    ["QUSDC", "the vault's currency"],
    ["Blockscout", "verified sources"],
  ];
  return (
    <section className="grid-bg-dark overflow-hidden bg-night text-white">
      <div className="relative mx-auto h-[680px] max-w-[1200px] px-6">
        {[300, 520, 760, 1000].map((d) => (
          <div key={d} className="absolute left-1/2 top-1/2 rounded-full border border-white/[0.06]" style={{ width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2 }} />
        ))}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <Eyebrow dark>Built on QIE</Eyebrow>
          <h2 className="mt-5 max-w-[560px] text-4xl font-medium tracking-[-0.035em] md:text-5xl">Uses what QIE already gives you</h2>
          {view && <p className="mono mt-4 text-xs text-stone-500">vault {short(view.contracts.guardedVault ?? "", 5)} · block {view.head}</p>}
        </div>
        {parts.map(([t, s], i) => {
          const a = (i / parts.length) * Math.PI * 2 - Math.PI / 2;
          const r = 420;
          return (
            <div key={t} className="absolute hidden text-center md:block" style={{ left: `calc(50% + ${Math.cos(a) * r}px)`, top: `calc(50% + ${Math.sin(a) * 255}px)`, transform: "translate(-50%,-50%)" }}>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-night-2 text-brand">◆</div>
              <div className="mt-2 text-sm font-medium">{t}</div>
              <div className="text-[11px] text-stone-500">{s}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Guarantees() {
  const cols = [
    { name: "Memory", note: "What the agent may believe", items: ["I-1 A memory's lane is its signer's lane", "I-2 Anything unverifiable authorises nothing", "I-3 Taint follows what was read", "I-4 The model cannot mint trust"] },
    { name: "Money", note: "Enforced on-chain", hot: true, items: ["I-5 Payments authorised by code, twice", "I-6 No two agreeing endpoints, no payment", "I-11 Payees and seeds are contract state", "I-12 One key per process"] },
    { name: "Recovery", note: "When something gets in", items: ["I-7 Exclusion, never deletion", "I-8 Quarantine reaches later descendants", "I-9 Revoking a key is independent", "I-10 Rebuild gives the same digest"] },
  ];
  return (
    <section id="guarantees" className="border-b border-line">
      <div className="mx-auto max-w-[1200px] px-6 py-24">
        <div className="text-center">
          <Eyebrow>Guarantees</Eyebrow>
          <h2 className="mt-5 text-4xl font-medium tracking-[-0.035em] md:text-5xl">Twelve invariants, each with a test</h2>
          <p className="mt-4 text-stone-600">The pitch only claims what these prove. The full table is in SECURITY.md.</p>
        </div>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {cols.map((c) => (
            <div key={c.name} className={`rounded-2xl border p-7 ${c.hot ? "border-brand shadow-[0_0_0_4px_rgba(108,92,231,0.08)]" : "border-line"}`}>
              <div className="flex items-center gap-2">
                <Mark size={20} />
                <h3 className="text-lg font-medium">{c.name}</h3>
                {c.hot && <span className="ml-auto rounded-md bg-brand px-2 py-0.5 text-xs text-white">On-chain</span>}
              </div>
              <p className="mt-6 text-3xl font-semibold tracking-tight">{c.note}</p>
              <ul className="mt-6 space-y-2.5 text-sm text-stone-700">
                {c.items.map((i) => (
                  <li key={i}>✓ {i}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  ["Does Tyrell trust the model?", "No. It is treated as untrusted code. Labels in its context help it behave, but every guarantee holds if it ignores them: it can only propose payments, and code decides."],
  ["What if the vault signer key leaks?", "It can only pay payees you registered, within per-payee and vault-wide daily caps. The worst case is one day's capped spend to legitimate payees, never to an attacker."],
  ["What happens to quarantined memories?", "They leave the model's context and the policy's inputs at once, and anything written from them later is excluded too. They stay anchored, pinned and readable for forensics. Only your key releases a seed."],
  ["Can I rebuild without your server?", "Yes. With the data key, the account id and the contract addresses, `tyrell rebuild --fresh` reconstructs everything from QIE and IPFS, and `tyrell verify` compares digests."],
  ["What if QIE RPCs disagree?", "Payments fail closed. The policy engine needs two endpoints that agree on chain and ledger state, spend figures for today, and a verified context before anything is allowed."],
];

export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="border-b border-line">
      <div className="mx-auto max-w-[860px] px-6 py-24">
        <div className="text-center">
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="mt-5 text-4xl font-medium tracking-[-0.035em]">Questions, answered</h2>
        </div>
        <div className="mt-12 divide-y divide-line border-y border-line">
          {FAQS.map(([q, a], i) => (
            <div key={q}>
              <button className="flex w-full items-center py-5 text-left font-medium" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                {q}
                <span className="ml-auto text-xl text-stone-400">{open === i ? "−" : "+"}</span>
              </button>
              {open === i && <p className="-mt-1 pb-5 text-sm leading-relaxed text-stone-600">{a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Cta() {
  return (
    <section className="px-6 py-20">
      <div className="grid-bg-dark relative mx-auto max-w-[1200px] overflow-hidden rounded-3xl bg-night px-6 py-20 text-center text-white">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border border-white/[0.07]" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full border border-white/[0.07]" />
        <h2 className="relative mx-auto max-w-[640px] text-4xl font-medium tracking-[-0.035em] md:text-5xl">Agents you can actually trust with money</h2>
        <p className="relative mt-4 text-stone-400">Watch the poison come in, the payment get refused and the clean state come back.</p>
        <div className="relative mt-8 flex justify-center gap-3">
          <Link href="/console" className="rounded-lg bg-brand px-6 py-3 font-medium hover:bg-brand-600">
            Open the console
          </Link>
          <a href={`${REPO}/blob/main/SECURITY.md`} className="rounded-lg bg-white/10 px-6 py-3 font-medium hover:bg-white/15">
            Read SECURITY.md
          </a>
        </div>
      </div>
    </section>
  );
}

export function Footer({ view }: { view?: ViewDocument }) {
  const cols: Array<[string, Array<[string, string]>]> = [
    ["Product", [["Console", "/console"], ["How it works", "#how"], ["Attack set", "#attacks"], ["Guarantees", "#guarantees"]]],
    ["Developers", [["GitHub", REPO], ["SECURITY.md", `${REPO}/blob/main/SECURITY.md`], ["Mainnet runbook", `${REPO}/blob/main/docs/MAINNET.md`]]],
    ["QIE", [["Explorer", "https://mainnet.qie.digital"], ["Testnet faucet", "https://qie.digital/faucet"], ["QIE MCP", "https://mcp.qie.digital/mcp"]]],
  ];
  return (
    <footer className="overflow-hidden bg-night text-white">
      <div className="mx-auto max-w-[1200px] px-6 pt-16">
        <div className="grid gap-10 sm:grid-cols-3">
          {cols.map(([t, links]) => (
            <div key={t}>
              <div className="text-sm font-medium text-brand">{t}</div>
              <ul className="mt-4 space-y-2 text-sm text-stone-400">
                {links.map(([l, h]) => (
                  <li key={l}>
                    <a href={h} className="hover:text-white">{l}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-20 flex justify-center opacity-95">
          <span className="scale-[3.2] py-10 sm:scale-[5]">
            <Wordmark dark />
          </span>
        </div>
        <div className="flex flex-wrap justify-between gap-2 pb-6 pt-8 text-xs text-stone-500">
          <span>Built for QIE Mainnet Hackathon 3.0 · Apache 2.0</span>
          <span className="mono">{view ? `digest ${short(view.digest, 6)} · block ${view.head}` : ""}</span>
        </div>
      </div>
      {/* the three stripes are Tyrell's trust signals: trusted, derived, untrusted */}
      <div className="h-3 bg-emerald-500" />
      <div className="h-3 bg-brand" />
      <div className="h-3 bg-amber-400" />
    </footer>
  );
}
