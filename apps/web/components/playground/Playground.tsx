"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Group, Result } from "@/lib/playground/suite";
import type { Step } from "@/lib/playground/chain";
import { Check, Pill } from "../argus/ui";
import { TryIt } from "./TryIt";
import { LiveAI } from "./LiveAI";
import { Recorded } from "./Recorded";

type Tab = "suite" | "ai" | "try" | "recorded";
type Run = { results: Result[]; done: boolean; gas: bigint; txs: number; ms: number; started: number };

const KIND: Record<Step["kind"], string> = {
  deploy: "bg-tint-blue text-[#2563eb]",
  send: "bg-brand-50 text-brand",
  read: "bg-paper text-muted",
  revert: "bg-[#ffe9ed] text-rose",
  check: "bg-[#e6f7f0] text-band-green",
  sign: "bg-tint-peach text-[#b26a00]",
  warp: "bg-tint-pink text-[#c026d3]",
  note: "bg-paper text-body",
};

export function Playground() {
  const [tab, setTab] = useState<Tab>("suite");
  useEffect(() => {
    if (window.location.hash === "#live-ai") setTab("ai");
  }, []);
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [run, setRun] = useState<Run>();
  const [open, setOpen] = useState<string>();
  const running = useRef(false);

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const mod = await import("@/lib/playground/suite");
    setGroups(mod.GROUPS);
    setTotal(mod.TOTAL);
    setOpen(undefined);
    const started = performance.now();
    setRun({ results: [], done: false, gas: 0n, txs: 0, ms: 0, started });
    const r = await mod.runSuite((res) => setRun((x) => (x ? { ...x, results: [...x.results, res], ms: Math.round(performance.now() - started) } : x)));
    setRun({ results: r.results, done: true, gas: r.gas, txs: r.txs, ms: r.ms, started });
    running.current = false;
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  const passed = run?.results.filter((r) => r.status === "pass").length ?? 0;
  const failed = run?.results.filter((r) => r.status === "fail").length ?? 0;
  const pct = total ? Math.round(((run?.results.length ?? 0) / total) * 100) : 0;

  return (
    <>
      <section className="relative overflow-hidden bg-white">
        <div className="grid-lines absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-white" />
        <div className="relative mx-auto max-w-[1000px] px-4 pb-10 pt-14 text-center sm:px-6 md:pt-20">
          <Pill>Playground</Pill>
          <h1 className="h-section mt-5 text-ink">Watch Tyrell&apos;s guarantees hold, live</h1>
          <p className="t-lead mx-auto mt-4 max-w-[680px] text-body">
            Tyrell&apos;s real contracts, compiled byte for byte, run in an EVM inside your browser, with real signatures. {total || 34} checks, from a forged memory to a banned agent. No wallet, no login.
          </p>

          <div className="mx-auto mt-8 grid max-w-[760px] grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [`${passed}/${total || "…"}`, "checks passed", failed ? "text-rose" : "text-band-green"],
              [run ? String(run.txs || run.results.reduce((n, r) => n + r.steps.filter((s) => s.kind === "send" || s.kind === "deploy").length, 0)) : "…", "transactions", "text-ink"],
              [run?.gas ? `${(Number(run.gas) / 1e6).toFixed(1)}M` : "…", "gas executed", "text-ink"],
              [run ? `${(run.ms / 1000).toFixed(1)}s` : "…", "in your browser", "text-ink"],
            ].map(([v, l, c]) => (
              <div key={l} className="rounded-2xl border border-line bg-white px-4 py-3">
                <div className={`text-[24px] font-medium tracking-tight ${c}`}>{v}</div>
                <div className="text-xs text-muted">{l}</div>
              </div>
            ))}
          </div>
          <div className="mx-auto mt-5 h-1.5 max-w-[760px] overflow-hidden rounded-full bg-paper">
            <div className={`h-full rounded-full transition-[width] duration-300 ${failed ? "bg-rose" : "bg-brand"}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <Check className="text-brand" /> EVM: Shanghai, chain id 1990 (QIE)
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="text-brand" /> Same bytecode as the deploy
            </span>
            <button onClick={start} disabled={!run?.done} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink transition-colors hover:bg-paper disabled:opacity-50">
              {run?.done ? "Run again" : "Running…"}
            </button>
          </div>
        </div>
      </section>

      <section className="bg-paper">
        <div className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6 md:py-14">
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1 text-sm [scrollbar-width:none]">
            {(
              [
                ["suite", "Live suite"],
                ["ai", "Live AI"],
                ["try", "Try it yourself"],
                ["recorded", "Recorded runs"],
              ] as const
            ).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2 transition-colors ${tab === t ? "bg-brand text-white" : "text-body hover:bg-paper"}`}>
                {label}
              </button>
            ))}
          </div>

          {tab === "suite" && (
            <div className="mt-6 space-y-5">
              {(groups.length ? groups : []).map((g) => {
                const rs = run?.results.filter((r) => r.group === g.id) ?? [];
                const ok = rs.filter((r) => r.status === "pass").length;
                return (
                  <div key={g.id} className="overflow-hidden rounded-[20px] border border-line bg-white">
                    <div className="border-b border-line px-5 py-4 sm:px-6">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[18px] font-medium tracking-[-0.01em] text-ink">{g.title}</h2>
                        <span className={`mono ml-auto rounded-full px-2.5 py-0.5 text-[11px] ${rs.length === g.tests.length && ok === rs.length ? "bg-[#e6f7f0] text-band-green" : rs.some((r) => r.status === "fail") ? "bg-[#ffe9ed] text-rose" : "bg-paper text-muted"}`}>
                          {ok}/{g.tests.length}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-body">{g.blurb}</p>
                    </div>
                    <ul className="divide-y divide-line">
                      {g.tests.map((t) => {
                        const r = rs.find((x) => x.name === t.name);
                        const id = `${g.id}:${t.name}`;
                        const isOpen = open === id;
                        return (
                          <li key={t.name}>
                            <button onClick={() => setOpen(isOpen ? undefined : id)} className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-paper/60 sm:px-6" aria-expanded={isOpen}>
                              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
                                {!r ? (
                                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-brand" />
                                ) : r.status === "pass" ? (
                                  <span className="grid h-5 w-5 place-items-center rounded-full bg-band-green text-white">
                                    <Check className="h-3 w-3" />
                                  </span>
                                ) : (
                                  <span className="grid h-5 w-5 place-items-center rounded-full bg-rose text-[11px] font-bold text-white">!</span>
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[15px] text-ink">{t.name}</span>
                                <span className="mt-0.5 block text-[13px] leading-snug text-muted">{t.why}</span>
                                {r?.error && <span className="mono mt-1 block text-[12px] text-rose">{r.error}</span>}
                              </span>
                              <span className="mono shrink-0 text-[11px] text-muted">{r ? `${r.ms} ms` : ""}</span>
                              <span className={`mt-0.5 shrink-0 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                            </button>
                            {isOpen && r && (
                              <ol className="mx-5 mb-4 space-y-1.5 rounded-xl bg-paper p-3 sm:mx-6">
                                {r.steps.map((s, i) => (
                                  <li key={i} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2 text-[12px]">
                                    <span className={`mono h-fit rounded px-1.5 py-0.5 text-center text-[10px] uppercase ${KIND[s.kind]}`}>{s.kind}</span>
                                    <span className="min-w-0 [overflow-wrap:anywhere]">
                                      <span className="mono text-ink">{s.text}</span>
                                      {s.detail && <span className="mono block text-muted">{s.detail}</span>}
                                      {s.gas !== undefined && <span className="mono block text-[10px] text-muted">gas {s.gas.toString()}</span>}
                                    </span>
                                  </li>
                                ))}
                              </ol>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
              {!groups.length && <p className="py-10 text-center text-sm text-muted">Loading the EVM and Tyrell&apos;s contracts…</p>}
              <p className="text-center text-xs text-muted">
                Source: <span className="mono">apps/web/lib/playground</span> · contracts from <span className="mono">contracts/out</span> via <span className="mono">pnpm gen:playground</span> ·{" "}
                <Link href="/docs/agents/overview" className="text-brand hover:underline">
                  how the agents network works
                </Link>
              </p>
            </div>
          )}
          {tab === "ai" && <LiveAI />}
          {tab === "try" && <TryIt />}
          {tab === "recorded" && <Recorded />}
        </div>
      </section>
    </>
  );
}

