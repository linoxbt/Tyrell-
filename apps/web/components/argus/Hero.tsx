"use client";

import { useState } from "react";
import { kpis, ruleTrace } from "@/lib/kpis";
import { amount, short, type ViewDocument } from "@/lib/view";
import { Mark } from "../Logo";
import { Bars, Button, Check, Icon } from "./ui";

export function Hero({ view }: { view?: ViewDocument }) {
  return (
    <section className="relative overflow-hidden bg-white">
      <div className="grid-lines absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 h-[420px] bg-gradient-to-b from-transparent via-white/70 to-white" />
      <div className="relative mx-auto max-w-[1200px] px-6 pt-[142px] text-center xl:px-0">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-sm text-ink shadow-[0_1px_2px_rgba(15,18,32,0.06)]">
          <span className="h-1.5 w-1.5 rounded-full bg-band-green" />
          New · Built on QIE {view ? `· ${view.network}` : "mainnet"}
        </span>
        <h1 className="h-hero mx-auto mt-6 max-w-[960px]">Know where your agent&apos;s memories came from</h1>
        <p className="t-lead mx-auto mt-6 max-w-[660px] text-body">
          Sign, anchor and trace everything your AI agent reads on QIE. Catch poisoned tokens and redirected payments before money moves.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Button href="/console">Open the console</Button>
          <Button href="#problem" variant="outline">See the problem</Button>
        </div>
        <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs font-medium uppercase text-muted">
          {["EIP-712 lane keys", "Payments enforced on-chain", "Rebuild from QIE + IPFS"].map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <Check /> {t}
            </li>
          ))}
        </ul>
      </div>

      {/* the dashboard, clipped by the dark band that follows, on the template's colour bands */}
      <div className="relative mt-[126px] h-[500px]">
        <div className="absolute inset-x-0 top-[84px] bottom-0">
          <div className="halftone h-[64px]" />
          <div className="h-[86px] bg-band-amber" />
          <div className="h-[76px] bg-band-violet" />
          <div className="h-full bg-band-green" />
        </div>
        <div className="relative mx-auto max-w-[1200px] px-6 xl:px-0">
          <Dashboard view={view} />
        </div>
      </div>
    </section>
  );
}

function Dashboard({ view }: { view?: ViewDocument }) {
  const decisions = [...(view?.decisions ?? [])].reverse();
  const [sel, setSel] = useState(0);
  const d = decisions[Math.min(sel, decisions.length - 1)];
  const blocked = decisions.find((x) => x.verdict?.decision === "BLOCK");
  const seed = view?.seeds.filter((s) => !s.released).at(-1);
  const radius = seed && view ? view.memories.filter((m) => m.seeds.includes(seed.seedId)).length : 0;
  const cards = view ? kpis(view) : [];

  return (
    <div className="relative">
      {blocked && (
        <div className="absolute -right-4 -top-9 z-20 flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-left shadow-[0_12px_40px_rgba(15,18,32,0.14)] xl:-right-10">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#ffe9ed] text-rose">
            <Icon name="shield" className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-medium text-ink">Payment blocked</span>
            <span className="mono block text-[10px] text-muted">policy.{ruleTrace(blocked).find((r) => r.state === "fail")?.id} · {blocked.verdict?.code}</span>
          </span>
        </div>
      )}
      {seed && (
        <div className="absolute -left-10 top-[400px] z-20 hidden w-[230px] -rotate-[9deg] rounded-xl bg-white p-4 text-left shadow-[0_12px_40px_rgba(15,18,32,0.16)] md:block xl:-left-24">
          <div className="flex items-center justify-between">
            <span className="mono text-[11px] tracking-wider text-brand">QUARANTINE</span>
            <span className="mono rounded bg-paper px-1.5 text-[9px] text-muted">SEED #{seed.seedId}</span>
          </div>
          <div className="mt-3 flex items-center">
            <span className="h-1.5 flex-[3] rounded-full bg-brand" />
            <span className="-ml-1 h-3.5 w-3.5 rounded-full border-2 border-brand bg-white" />
            <span className="h-1.5 flex-1 rounded-full bg-line" />
          </div>
          <div className="mt-2 flex justify-between text-[10px]">
            <span className="mono text-muted">{radius} memories</span>
            <span className="mono italic text-band-green">release: user key</span>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-[20px] border border-line bg-[#f7f8fa] text-left shadow-[0_4px_76px_rgba(15,18,32,0.25)]">
        <div className="flex items-center gap-2 border-b border-line bg-white px-5 py-3.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="mono mx-auto flex items-center gap-2 rounded-full border border-line px-4 py-1.5 text-[13px] text-body">
            <Mark size={14} /> app.tyrell/{view?.network ?? "mainnet"}/steward
          </span>
        </div>
        <div className="grid grid-cols-[68px_1fr]">
          <div className="flex flex-col items-center gap-4 border-r border-line bg-white py-4">
            <Mark size={26} />
            <span className="mt-3 grid h-10 w-10 place-items-center rounded-lg border border-brand/40 bg-brand-50 text-brand">
              <Icon name="pulse" />
            </span>
            {(["check", "shield", "coin", "gear"] as const).map((n) => (
              <span key={n} className="grid h-10 w-10 place-items-center text-muted">
                <Icon name={n} />
              </span>
            ))}
          </div>
          <div className="min-w-0 px-7 pt-5">
            <div className="flex items-center gap-2">
              <span className="text-lg font-medium text-ink">steward</span>
              <span className="mono text-[13px] text-muted">/ decisions</span>
              <span className="ml-auto flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-[13px] text-body">
                <span className="h-1.5 w-1.5 rounded-full bg-band-green" /> {view?.network ?? "mainnet"}
              </span>
              <span className="hidden rounded-full border border-line bg-white px-3 py-1 text-[13px] text-body sm:block">block {view?.head ?? "—"}</span>
              <span className="hidden rounded-full border border-line bg-white px-3 py-1 text-[13px] text-body sm:block">Filter</span>
            </div>
            <div className="mt-5 flex gap-7 border-b border-line text-[15px]">
              {["Decisions", "Memories", "Quarantine", "Rebuild"].map((t, i) => (
                <span key={t} className={`pb-3 ${i === 0 ? "-mb-px border-b-2 border-brand text-ink" : "text-muted"}`}>{t}</span>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
              {cards.map((c) => (
                <div key={c.label} className="rounded-xl border border-line bg-white px-4 py-4">
                  <div className="flex items-center justify-between text-[13px] text-body">
                    {c.label}
                    <span className={`mono text-[11px] ${c.noteColor}`}>{c.note}</span>
                  </div>
                  <div className="mt-2 text-[30px] font-medium tracking-tight text-ink">{c.value}</div>
                  <div className="mt-2">
                    <Bars values={c.bars} color={c.color} />
                  </div>
                </div>
              ))}
              {!view && <div className="col-span-4 py-8 text-sm text-muted">Loading the projection…</div>}
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3.5 lg:grid-cols-[0.85fr_1.6fr]">
              <div className="rounded-xl border border-line bg-white">
                <div className="mono flex justify-between px-4 py-3 text-[12px] tracking-wider text-muted">
                  DECISIONS <span>{decisions.length}</span>
                </div>
                {decisions.slice(0, 4).map((x, i) => (
                  <button
                    key={x.id}
                    onClick={() => setSel(i)}
                    className={`flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left ${i === sel ? "border-brand bg-paper" : "border-transparent"}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${x.verdict?.decision === "ALLOW" ? "bg-band-green" : "bg-rose"}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-ink">{String(x.proposal?.payeeLabel ?? "payment")} → {short(String(x.proposal?.recipient ?? ""), 4)}</span>
                      <span className="mono block text-[11px] text-muted">{short(x.id, 4)}</span>
                    </span>
                    <span className="mono ml-auto text-[12px] text-body">{view ? amount(view, x.proposal?.amount) : ""}</span>
                  </button>
                ))}
              </div>
              <div className="rounded-xl border border-line bg-white px-5 py-4">
                {d ? (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="mono text-[14px] text-ink">{short(d.id, 4)}</span>
                      <span className={`mono rounded-full px-2.5 py-0.5 text-[11px] ${d.verdict?.decision === "ALLOW" ? "bg-[#e6f7f0] text-band-green" : "bg-[#ffe9ed] text-rose"}`}>
                        {d.verdict?.decision === "ALLOW" ? "ALLOW" : d.verdict?.code}
                      </span>
                      <span className="mono ml-auto text-[12px] text-body">
                        {d.parents.length} memories read · {view ? amount(view, d.proposal?.amount) : ""}
                      </span>
                    </div>
                    <div className="mt-4 space-y-2.5">
                      {ruleTrace(d).map((r) => (
                        <div key={r.id} className="grid grid-cols-[150px_1fr] items-center gap-3">
                          <span className="mono truncate text-[12px] text-body">
                            {r.id} {r.name}
                          </span>
                          <span className="h-2.5 rounded-full bg-paper">
                            <span
                              className="block h-full rounded-full"
                              style={{ width: r.state === "skip" ? "0%" : "100%", background: r.state === "pass" ? "#7c5cff" : "#ff5c7a" }}
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="py-6 text-sm text-muted">No payment proposals yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
