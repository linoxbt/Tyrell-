"use client";

import { useState } from "react";
import { kpis, ruleTrace } from "@/lib/kpis";
import { amount, short, type ViewDocument } from "@/lib/view";
import { Mark } from "../Logo";
import { Bars, Button, Check, Fit, Icon } from "./ui";

export function Hero({ view }: { view?: ViewDocument }) {
  const [k, setK] = useState(1);
  return (
    <section className="relative overflow-hidden bg-white">
      <div className="grid-lines absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 h-[420px] bg-gradient-to-b from-transparent via-white/70 to-white" />
      <div className="relative mx-auto max-w-[1200px] px-6 pt-16 text-center sm:pt-24 lg:pt-[142px] xl:px-0">
        <h1 className="h-hero mx-auto max-w-[960px]">Know where your agent&apos;s memories came from</h1>
        <p className="t-lead mx-auto mt-6 max-w-[660px] text-body">
          Sign, anchor and trace everything your AI agent reads on QIE. Catch poisoned tokens and redirected payments before money moves.
        </p>
        <div className="mx-auto mt-8 flex max-w-[340px] flex-col gap-3 sm:mt-10 sm:max-w-none sm:flex-row sm:justify-center sm:gap-4">
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
      <div className="relative mt-16 sm:mt-24 lg:mt-[126px]">
        <div className="absolute inset-x-0 bottom-0 top-[70px] sm:top-[var(--bt)]" style={{ "--bt": `${84 * k}px` } as React.CSSProperties}>
          <div className="halftone h-10 sm:h-[var(--b1)]" style={{ "--b1": `${64 * k}px` } as React.CSSProperties} />
          <div className="h-14 bg-band-amber sm:h-[var(--b2)]" style={{ "--b2": `${86 * k}px` } as React.CSSProperties} />
          <div className="h-12 bg-band-violet sm:h-[var(--b3)]" style={{ "--b3": `${76 * k}px` } as React.CSSProperties} />
          <div className="h-full bg-band-green" />
        </div>
        <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 xl:px-0" data-no-reveal>
          {/* phones get a compact app view of the same data; larger screens get the full dashboard, scaled to fit */}
          <div className="sm:hidden">
            <MobileDashboard view={view} />
          </div>
          <div className="hidden sm:block">
            <Fit width={1200} clip={500} onScale={setK}>
              <Dashboard view={view} />
            </Fit>
          </div>
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
        <div className="absolute -right-6 -top-9 z-20 flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-left shadow-[0_12px_40px_rgba(15,18,32,0.14)]">
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
        <div className="absolute -left-10 top-[400px] z-20 w-[230px] -rotate-[9deg] rounded-xl bg-white p-4 text-left shadow-[0_12px_40px_rgba(15,18,32,0.16)]">
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
            <Mark size={14} /> tyrell · your account
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
                <span className="h-1.5 w-1.5 rounded-full bg-band-green" /> QIE
              </span>
              <span className="rounded-full border border-line bg-white px-3 py-1 text-[13px] text-body">Filter</span>
            </div>
            <div className="mt-5 flex gap-7 border-b border-line text-[15px]">
              {["Decisions", "Memories", "Quarantine", "Rebuild"].map((t, i) => (
                <span key={t} className={`pb-3 ${i === 0 ? "-mb-px border-b-2 border-brand text-ink" : "text-muted"}`}>{t}</span>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-4 gap-3.5">
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
            <div className="mt-5 grid grid-cols-[0.85fr_1.6fr] gap-3.5">
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

/** The phone version of the hero dashboard: the same projection, laid out like a mobile app screen. */
function MobileDashboard({ view }: { view?: ViewDocument }) {
  const decisions = [...(view?.decisions ?? [])].reverse();
  const blocked = decisions.find((x) => x.verdict?.decision === "BLOCK");
  const d = blocked ?? decisions[0];
  const cards = view ? kpis(view) : [];
  return (
    <div className="relative mx-auto max-w-[360px] pb-6">
      {blocked && (
        <div className="absolute -right-1 -top-11 z-20 flex items-center gap-2.5 rounded-xl bg-white px-3 py-2.5 text-left shadow-[0_12px_40px_rgba(15,18,32,0.16)]">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[#ffe9ed] text-rose">
            <Icon name="shield" className="h-3.5 w-3.5" />
          </span>
          <span>
            <span className="block text-[13px] font-medium text-ink">Payment blocked</span>
            <span className="mono block text-[9px] text-muted">{blocked.verdict?.code}</span>
          </span>
        </div>
      )}
      <div className="overflow-hidden rounded-[28px] border border-line bg-[#f7f8fa] text-left shadow-[0_4px_60px_rgba(15,18,32,0.22)]">
        <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-3">
          <Mark size={22} />
          <span className="text-[15px] font-medium text-ink">steward</span>
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-[11px] text-body">
            <span className="h-1.5 w-1.5 rounded-full bg-band-green" /> QIE
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3">
          {cards.map((c) => (
            <div key={c.label} className="min-w-0 rounded-xl border border-line bg-white px-3 py-2.5">
              <div className="truncate text-[11px] text-body">{c.label}</div>
              <div className="mt-0.5 text-[22px] font-medium leading-tight tracking-tight text-ink">{c.value}</div>
              <div className="mt-1">
                <Bars values={c.bars} color={c.color} count={12} />
              </div>
            </div>
          ))}
          {!view && <div className="col-span-2 py-6 text-center text-sm text-muted">Loading…</div>}
        </div>
        {d && (
          <div className="mx-3 mb-3 rounded-xl border border-line bg-white px-3.5 py-3">
            <div className="flex items-center gap-2">
              <span className="mono text-[12px] text-ink">{short(d.id, 4)}</span>
              <span className={`mono rounded-full px-2 py-0.5 text-[10px] ${d.verdict?.decision === "ALLOW" ? "bg-[#e6f7f0] text-band-green" : "bg-[#ffe9ed] text-rose"}`}>
                {d.verdict?.decision === "ALLOW" ? "ALLOW" : d.verdict?.code}
              </span>
              <span className="mono ml-auto text-[11px] text-body">{view ? amount(view, d.proposal?.amount) : ""}</span>
            </div>
            <div className="mt-3 space-y-1.5">
              {ruleTrace(d).map((r) => (
                <div key={r.id} className="grid grid-cols-[24px_1fr] items-center gap-2">
                  <span className="mono text-[10px] text-muted">{r.id}</span>
                  <span className="h-2 rounded-full bg-paper">
                    <span className="block h-full rounded-full" style={{ width: r.state === "skip" ? "0%" : "100%", background: r.state === "pass" ? "#7c5cff" : "#ff5c7a" }} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
