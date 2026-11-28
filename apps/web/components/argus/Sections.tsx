"use client";

import { useState } from "react";
import { ATTACKS } from "@/lib/attacks";
import { short, type ViewDocument } from "@/lib/view";
import { Mark, Wordmark } from "../Logo";
import { Button, Check, Icon, Pill, REPO, SectionHead } from "./ui";

/* ---------- strip under the hero: the template's customer logo marquee, carrying the QIE parts Tyrell runs on ---------- */
export function Marquee({ view }: { view?: ViewDocument }) {
  const items = [
    "QIE Mainnet · chain 1990",
    "QIE Wallet",
    "QIE ID",
    "QIE MCP",
    "QUSDC",
    "IPFS · Pinata",
    "EIP-712",
    "Blockscout",
    view ? `block ${view.head}` : "MemoryAnchor",
  ];
  return (
    <section className="overflow-hidden bg-night py-10">
      <p className="text-center text-sm text-fog">Built on the parts QIE already ships</p>
      <div className="relative mt-6 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
        <div className="marquee flex w-max gap-14">
          {[...items, ...items].map((t, i) => (
            <span key={i} className="flex items-center gap-2.5 whitespace-nowrap text-xl font-medium text-mist/80">
              <span className="h-2 w-2 rotate-45 bg-brand" /> {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- "How it works": four glow-bordered step cards on the paper grid ---------- */
export function Steps() {
  const steps: Array<[string, string, Parameters<typeof Icon>[0]["name"]]> = [
    ["Sign", "Each process holds one lane key you registered on-chain: user, agent, wallet, control.", "check"],
    ["Anchor", "Bodies are encrypted to IPFS. Hash, signer and CID are anchored on QIE by MemoryAnchor.", "list"],
    ["Trace", "Whatever Steward read becomes the parent of what it writes. Taint follows the information.", "graph"],
    ["Guard", "The model only proposes. Code pays registered payees within caps, and the vault checks again.", "shield"],
  ];
  return (
    <section id="how" className="relative overflow-hidden bg-paper">
      <div className="grid-lines absolute inset-0" />
      <div className="relative mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-[120px] xl:px-0">
        <SectionHead pill="How it works" title={<>From a signed memory to a payment the chain approved</>} lead="Four steps. The language model is untrusted code at every one of them." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 sm:gap-5 md:mt-16 lg:grid-cols-4">
          {steps.map(([t, b, icon], i) => (
            <div key={t} className="glow-light rounded-[18px]">
              <div className="h-full rounded-[17px] bg-white p-6">
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand">
                    <Icon name={icon} />
                  </span>
                  <span className="mono text-xs text-muted">0{i + 1}</span>
                </div>
                <h3 className="mt-8 text-[22px] sm:mt-14 font-medium tracking-[-0.01em] text-ink">{t}</h3>
                <p className="mt-2 text-[15px] leading-[1.6] text-body">{b}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Platform: the template's five tinted cards, each with a small piece of real UI ---------- */
export function Platform({ view }: { view?: ViewDocument }) {
  const seed = view?.seeds.filter((s) => !s.released).at(-1);
  const radius = seed && view ? view.memories.filter((m) => m.seeds.includes(seed.seedId)) : [];
  const incidents = (view?.incidents ?? []).slice(-3).reverse();
  const blocked = (view?.decisions ?? []).filter((d) => d.verdict?.decision === "BLOCK").length;
  const payee = view?.payees.find((p) => p.active && !p.suspended);
  return (
    <section id="platform" className="bg-white">
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-[110px] xl:px-0">
        <SectionHead pill="Platform" title={<>Everything you need to let an agent touch money</>} />
        <div className="mt-10 grid gap-4 sm:gap-6 md:mt-14 md:grid-cols-2 lg:grid-cols-3">
          <Card tint="bg-tint-peach" className="md:col-span-2" title="Blast radius" body="Pick a poisoned source and see every memory, summary and decision it reached, and the vault transactions they referenced.">
            <div className="relative mt-8 sm:h-[180px]">
              <div className="absolute left-[4%] top-10 hidden w-[46%] -rotate-[3deg] rounded-xl bg-white/80 p-4 shadow-[0_10px_30px_rgba(15,18,32,0.08)] sm:block">
                <Tree rows={radius.slice(0, 5)} dim />
              </div>
              <div className="relative rounded-xl bg-white p-4 shadow-[0_14px_40px_rgba(15,18,32,0.12)] sm:absolute sm:right-[6%] sm:top-0 sm:w-[50%] sm:rotate-[3deg]">
                <Tree rows={radius.slice(0, 6)} />
              </div>
            </div>
          </Card>
          <Card tint="bg-tint-lilac" title="Quarantine, not deletion" body="One on-chain seed excludes a source and everything descended from it, even memories written later. Only your key releases it.">
            <div className="mt-10 -rotate-[3deg] rounded-xl bg-white p-4 shadow-[0_12px_36px_rgba(15,18,32,0.1)]">
              <div className="flex items-center">
                <span className="h-1.5 flex-[3] rounded-full bg-brand" />
                <span className="-ml-1 h-4 w-4 rounded-full border-2 border-brand bg-white" />
                <span className="h-1.5 flex-1 rounded-full bg-line" />
              </div>
              <div className="mt-3 flex justify-between text-[11px]">
                <span className="text-muted">{seed ? `Seed #${seed.seedId} · ${radius.length} memories` : "Seed · memories"}</span>
                <span className="mono rounded border border-line px-1.5 text-[10px] text-muted">RELEASE: USER KEY</span>
              </div>
            </div>
          </Card>
          <Card tint="bg-tint-pink" title="AI sentinel" body="Every transfer, token name, NFT description and MCP read is scored by rules and an AI judge. The AI can raise an alarm, never clear one.">
            <div className="mt-8 rotate-[2deg] rounded-xl bg-white p-4 shadow-[0_12px_36px_rgba(15,18,32,0.08)]">
              {(incidents.length ? incidents : [{ memoryId: "x", score: 85, rules: ["imperative", "embedded", "payeeWords"] }]).map((i) => (
                <div key={i.memoryId} className="flex items-center gap-3 py-1 text-[12px]">
                  <span className="mono w-8 font-medium text-ink">{i.score}</span>
                  <span className="h-1.5 flex-1 rounded-full bg-paper">
                    <span className="block h-full rounded-full bg-[#e879f9]" style={{ width: `${i.score}%` }} />
                  </span>
                  <span className="mono shrink-0 text-[10px] text-muted">{i.rules[0]}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card tint="bg-tint-blue" title="Rebuild from the chain" body="Delete the database. Tyrell rebuilds every class, quarantine and payee from QIE and IPFS, and proves the digest matches.">
            <div className="mt-8 rounded-xl bg-white p-4 shadow-[0_12px_36px_rgba(15,18,32,0.08)]">
              <div className="mono flex justify-between text-[11px] text-muted">
                projection digest <span className="text-band-green">✓ match</span>
              </div>
              <div className="mono mt-2 text-[12px] text-ink">live&nbsp;&nbsp;&nbsp;&nbsp;{view ? short(view.digest, 6) : "0x…"}</div>
              <div className="mono text-[12px] text-ink">rebuilt {view ? short(view.digest, 6) : "0x…"}</div>
            </div>
          </Card>
          <Card tint="bg-tint-grey" title="A stolen signer key pays no one new" body="The vault signer can only pay payees you registered, within per-payee and vault-wide daily caps.">
            <div className="mt-8 rounded-xl bg-white p-4 shadow-[0_12px_36px_rgba(15,18,32,0.08)]">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-ink">{payee?.label ?? "landlord"}</span>
                <span className="mono rounded-full bg-[#e6f7f0] px-2 text-[10px] text-band-green">REGISTERED</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[12px]">
                <span className="text-ink">0xBAD…</span>
                <span className="mono rounded-full bg-[#ffe9ed] px-2 text-[10px] text-rose">{blocked ? `${blocked} BLOCKED` : "REVERTS"}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

function Tree({ rows, dim = false }: { rows: ViewDocument["memories"]; dim?: boolean }) {
  const fallback = ["wallet", "agent", "agent", "control", "control"].map((l, i) => ({ id: `f${i}`, laneName: l, kind: 0, cls: "untrusted" }));
  const list = (rows.length ? rows : fallback) as Array<{ id: string; laneName: string; cls: string }>;
  const color: Record<string, string> = { wallet: "text-[#ea580c]", agent: "text-brand", control: "text-band-green", user: "text-[#2563eb]" };
  return (
    <div className={`mono space-y-1.5 text-[12.5px] ${dim ? "opacity-60" : ""}`}>
      {list.map((m, i) => (
        <div key={m.id} className="flex items-center" style={{ paddingLeft: Math.min(i, 3) * 14 }}>
          <span className={color[m.laneName] ?? "text-ink"}>{m.laneName}.memory</span>
          <span className="ml-auto text-muted">{m.id.startsWith("f") ? "" : short(m.id, 3)}</span>
        </div>
      ))}
    </div>
  );
}

function Card({ tint, title, body, className = "", children }: { tint: string; title: string; body: string; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`overflow-hidden rounded-[24px] px-6 pb-7 pt-6 sm:px-[30px] sm:pb-8 sm:pt-[30px] ${tint} ${className}`}>
      <h3 className="text-[21px] font-medium leading-[1.3] tracking-[-0.01em] text-ink sm:text-[24px]">{title}</h3>
      <p className="mt-3 max-w-[420px] text-base leading-[1.6] text-body">{body}</p>
      {children}
    </div>
  );
}

/* ---------- the template's "eval gate" block: copy and checklist beside a gradient-halftone card ---------- */
export function AttackGate() {
  return (
    <section id="attacks" className="bg-paper">
      <div className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] items-center gap-10 px-4 py-20 sm:px-6 md:py-[110px] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14 xl:px-0">
        <div>
          <Pill>Attack set</Pill>
          <h2 className="h-section mt-5 text-ink">Ten attacks. A fully compromised model. Nothing paid.</h2>
          <p className="t-lead mt-5 text-body">
            The runner scripts the model to take every bait, because the guarantees must not depend on it. Each attack must end blocked, reverted or excluded,
            with the attacker&apos;s balance unchanged.
          </p>
          <ul className="mt-7 space-y-3 text-base text-muted">
            {["Runs against a live deployment with one command", "The attacker holds only its own key", "Prints the pass table in the README"].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-brand text-white">
                  <Check className="h-3 w-3" />
                </span>
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-9">
            <Button href={`${REPO}#attack-set`}>See the attack runner</Button>
          </div>
        </div>
        <div className="gradient-halftone rounded-[24px] p-3 sm:p-6 md:p-10">
          <div className="rounded-2xl bg-white p-4 shadow-[0_20px_60px_rgba(15,18,32,0.25)] sm:p-5">
            <div className="flex items-center gap-2 border-b border-line pb-3">
              <span className="mono min-w-0 truncate text-[12px] text-muted">tyrell attack run<span className="hidden sm:inline"> · compromised model</span></span>
              <span className="mono ml-auto rounded-full bg-[#e6f7f0] px-2.5 py-0.5 text-[11px] font-medium text-band-green">10 / 10 PASSED</span>
            </div>
            <ul className="divide-y divide-line">
              {ATTACKS.map((a, i) => (
                <li key={a.name} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-2 text-[13px] sm:grid-cols-[22px_minmax(0,1fr)_auto] sm:items-start">
                  <span className="mono text-muted">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-ink">{a.name}</span>
                  <span className="mono col-start-2 text-[11px] text-rose sm:col-start-3 sm:text-right">{a.result}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- integrations: dark band with concentric arcs and floating badges ---------- */
type Badge = { icon: Parameters<typeof Icon>[0]["name"]; c: string; label: string; x: string; y: number; mx: string; my: number };
/** x/y: the wide orbit (lg and up). mx/my: phones and tablets, three badges above the heading and four below. */
const BADGES: Badge[] = [
  { icon: "coin", c: "text-amber", label: "QUSDC", x: "6%", y: 60, mx: "15%", my: 40 },
  { icon: "graph", c: "text-[#a78bfa]", label: "QIE ID", x: "5%", y: 255, mx: "50%", my: 14 },
  { icon: "pulse", c: "text-rose", label: "MemoryAnchor", x: "92%", y: 70, mx: "85%", my: 40 },
  { icon: "list", c: "text-[#60a5fa]", label: "QIE MCP", x: "9%", y: 440, mx: "12%", my: 372 },
  { icon: "shield", c: "text-amber", label: "QIE Wallet", x: "19%", y: 245, mx: "37%", my: 402 },
  { icon: "check", c: "text-[#60a5fa]", label: "Blockscout", x: "81%", y: 245, mx: "63%", my: 402 },
  { icon: "flag", c: "text-band-green", label: "GuardedVault", x: "91%", y: 420, mx: "88%", my: 372 },
];

function Orb({ b, compact }: { b: Badge; compact?: boolean }) {
  return (
    <div className={`absolute -translate-x-1/2 ${compact ? "lg:hidden" : "hidden lg:block"}`} style={compact ? { left: b.mx, top: b.my } : { left: b.x, top: b.y }}>
      <span
        className={`mx-auto grid place-items-center rounded-full border border-white/10 bg-night-2 ${compact ? "h-12 w-12 shadow-[0_0_0_6px_rgba(255,255,255,0.02)]" : "h-[60px] w-[60px] shadow-[0_0_0_8px_rgba(255,255,255,0.02)]"} ${b.c}`}
      >
        <Icon name={b.icon} className={compact ? "h-5 w-5" : "h-6 w-6"} />
      </span>
      <span className={`mt-2 block whitespace-nowrap text-center text-fog ${compact ? "text-[10.5px]" : "text-[11px]"}`}>{b.label}</span>
    </div>
  );
}

export function BuiltOnQie(_: { view?: ViewDocument }) {
  return (
    <section className="relative overflow-hidden bg-night text-snow">
      <div className="relative mx-auto h-[500px] max-w-[1440px] sm:h-[520px] lg:h-[576px]">
        {/* arcs: tighter rings around the heading on small screens */}
        {[360, 540, 720, 900].map((d) => (
          <div key={`s${d}`} className="absolute left-1/2 top-[235px] rounded-full border border-white/[0.08] lg:hidden" style={{ width: d, height: d * 1.1, marginLeft: -d / 2, marginTop: -(d * 1.1) / 2 }} />
        ))}
        {[560, 820, 1080, 1340].map((d) => (
          <div key={d} className="absolute left-1/2 top-[250px] hidden rounded-full border border-white/[0.09] lg:block" style={{ width: d, height: d * 1.15, marginLeft: -d / 2, marginTop: -(d * 1.15) / 2 }} />
        ))}
        {BADGES.map((b) => (
          <Orb key={`m${b.label}`} b={b} compact />
        ))}
        {BADGES.map((b) => (
          <Orb key={b.label} b={b} />
        ))}
        <div className="absolute inset-x-0 top-[138px] px-6 text-center sm:top-[150px] lg:top-[128px]">
          <Pill dark>Built on QIE</Pill>
          <h2 className="h-section mx-auto mt-4 max-w-[520px] text-snow lg:mt-5">Uses what QIE already gives you</h2>
          <p className="mono mx-auto mt-4 max-w-[300px] text-[11px] leading-relaxed text-fog sm:max-w-none sm:text-xs lg:mt-5">Six contracts for QIE Mainnet · chain 1990</p>
        </div>
        <div className="absolute inset-x-0 bottom-0 hidden h-16 bg-gradient-to-b from-transparent to-night lg:block" />
      </div>
    </section>
  );
}

/* ---------- pricing → guarantees: the template's toggle and three plan cards, middle one highlighted ---------- */
export function Guarantees() {
  const [model, setModel] = useState<"honest" | "compromised">("compromised");
  const cols = [
    { name: "Memory", note: "What the agent may believe", items: ["I-1 A memory's lane is its signer's lane", "I-2 Unverifiable memories authorise nothing", "I-3 Taint follows what was read", "I-4 The model cannot mint trust"] },
    { name: "Money", note: "Enforced on-chain", hot: true, items: ["I-5 Payments authorised by code, twice", "I-6 Two agreeing endpoints or no payment", "I-11 Payees and seeds are contract state", "I-12 One key per process"] },
    { name: "Recovery", note: "When something gets in", items: ["I-7 Exclusion, never deletion", "I-8 Quarantine reaches later descendants", "I-9 Key revocation is independent", "I-10 A rebuild gives the same digest"] },
  ];
  return (
    <section id="guarantees" className="bg-paper">
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-[110px] xl:px-0">
        <SectionHead pill="Guarantees" title="Twelve invariants, each with a test" lead="Flip the model. Every line below holds either way; that is the point." />
        <div className="mt-9 flex justify-center">
          <div className="inline-flex rounded-full border border-line bg-white p-1 text-sm">
            {(["honest", "compromised"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModel(m)}
                className={`rounded-full px-4 py-2 transition-colors duration-200 sm:px-5 ${model === m ? "bg-brand text-white" : "text-muted"}`}
                aria-pressed={model === m}
              >
                {m === "honest" ? "Honest model" : "Compromised model"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-10 grid gap-4 sm:gap-6 md:mt-12 md:grid-cols-3">
          {cols.map((c) => (
            <div key={c.name} className={`rounded-[16px] p-2 ${c.hot ? "bg-brand" : "bg-white shadow-[0_1px_2px_rgba(15,18,32,0.06)]"}`}>
              <div className="rounded-[12px] bg-white px-6 pb-8 pt-6">
                <div className="flex items-center gap-2.5">
                  <Mark size={22} />
                  <h3 className="text-lg font-medium text-ink">{c.name}</h3>
                  {c.hot && <span className="ml-auto rounded-md bg-brand-50 px-2 py-0.5 text-xs text-brand">On-chain</span>}
                </div>
                <p className="mt-6 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-ink lg:mt-7 lg:text-[30px]">{c.note}</p>
                <p className="mono mt-3 text-xs text-muted">{model === "compromised" ? "holds with a compromised model" : "holds with an honest model"}</p>
                <div className="my-6 h-px bg-line" />
                <ul className="space-y-3 text-[15px] text-muted">
                  {c.items.map((i) => (
                    <li key={i} className="flex gap-2.5">
                      <Check className="mt-1 text-brand" /> {i}
                    </li>
                  ))}
                </ul>
              </div>
              {c.hot && <p className="px-4 py-3 text-center text-sm text-white">GuardedVault re-checks every payment</p>}
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
  ["What happens to quarantined memories?", "They leave the model's context and the policy's inputs at once, and anything written from them later is excluded too. They stay anchored, pinned and readable. Only your key releases a seed."],
  ["Can I rebuild without your server?", "Yes. With the data key, the account id and the contract addresses, `tyrell rebuild --fresh` reconstructs everything from QIE and IPFS, and `tyrell verify` compares digests."],
  ["Is Tyrell AI-powered?", "Yes, where AI helps and cannot hurt. An AI judge reads everything that lands in your wallet and flags manipulation that rules miss, with a reason you can read. It can only raise alarms. What gets paid is decided by code and the chain, so a fooled model can never move money."],
  ["What if QIE RPCs disagree?", "Payments fail closed. The policy engine needs two endpoints that agree on chain and ledger state before anything is allowed."],
];

export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="bg-white">
      <div className="mx-auto max-w-[800px] px-4 py-20 sm:px-6 md:py-[110px]">
        <SectionHead pill="FAQ" title="Questions, answered" />
        <div className="mt-12 space-y-3">
          {FAQS.map(([q, a], i) => (
            <div key={q} className="rounded-[16px] border border-line bg-white px-5 transition-shadow duration-300 hover:shadow-[0_4px_20px_rgba(15,18,32,0.05)] sm:px-6">
              <button className="flex w-full items-center gap-4 py-5 text-left text-[17px] font-medium sm:text-[20px] tracking-[-0.01em] text-ink" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                {q}
                <span className={`ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-full text-xl transition-colors ${open === i ? "bg-brand text-white" : "bg-paper text-muted"}`}>{open === i ? "−" : "+"}</span>
              </button>
              <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open === i ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="overflow-hidden">
                  <p className="-mt-1 pb-6 text-base leading-[1.6] text-body">{a}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Cta() {
  return (
    <section className="bg-white px-4 pb-20 sm:px-6 md:pb-[110px]">
      <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-[24px] bg-night px-5 py-16 text-center text-snow sm:px-6 md:py-[90px]">
        <div className="grid-lines-dark absolute inset-0" />
        <div className="absolute left-1/2 top-0 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.45),transparent_65%)]" />
        <Pill dark>Get started</Pill>
        <h2 className="h-section relative mx-auto mt-5 max-w-[680px]">Agents you can actually trust with money</h2>
        <p className="t-lead relative mx-auto mt-4 max-w-[540px] text-mist">Watch the poison come in, the payment get refused and the clean state come back.</p>
        <div className="relative mx-auto mt-9 flex max-w-[320px] flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center sm:gap-4">
          <Button href="/console">Open the console</Button>
          <Button href={`${REPO}/blob/main/SECURITY.md`} variant="dark">Read SECURITY.md</Button>
        </div>
      </div>
    </section>
  );
}

export function Footer({ view }: { view?: ViewDocument }) {
  const cols: Array<[string, Array<[string, string]>]> = [
    ["Product", [["Console", "/console"], ["Playground", "/playground"], ["Docs", "/docs"], ["Get started", "/start"]]],
    ["Developers", [["GitHub", REPO], ["SECURITY.md", `${REPO}/blob/main/SECURITY.md`], ["Mainnet runbook", `${REPO}/blob/main/docs/MAINNET.md`]]],
    ["QIE", [["Explorer", "https://mainnet.qie.digital"], ["Testnet faucet", "https://qie.digital/faucet"], ["QIE MCP", "https://mcp.qie.digital/mcp"]]],
  ];
  return (
    <footer className="relative overflow-hidden bg-footer text-snow">
      <div className="mx-auto max-w-[1200px] px-4 pt-16 sm:px-6 md:pt-20 xl:px-0">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div className="col-span-2 md:col-span-1">
            <Wordmark dark />
            <p className="mt-4 max-w-[280px] text-sm leading-relaxed text-fog">Provenance and quarantine for AI-agent memory, on QIE.</p>
          </div>
          {cols.map(([t, links]) => (
            <div key={t}>
              <div className="text-[19px] font-medium text-brand md:text-[22px]">{t}</div>
              <ul className="mt-5 space-y-3 text-base text-mist">
                {links.map(([l, h]) => (
                  <li key={l}>
                    <a href={h} className="hover:text-white">{l}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-wrap justify-between gap-2 border-t border-white/10 py-6 text-xs text-fog md:mt-20">
          <span>Built for QIE Mainnet Hackathon 3.0 · Apache 2.0</span>
          <span className="mono">{view ? `digest ${short(view.digest, 6)} · block ${view.head}` : ""}</span>
        </div>
      </div>
      {/* the template's three stripes, here Tyrell's trust classes: trusted, derived, untrusted */}
      <div className="halftone-violet h-6" />
      <div className="h-4 bg-band-green" />
      <div className="h-4 bg-band-violet" />
      <div className="h-4 bg-band-amber" />
    </footer>
  );
}
