"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ATTACKS } from "@/lib/attacks";
import { REPO } from "../argus/ui";

interface T {
  name: string;
  status: "pass" | "fail" | "skip";
  ms?: number;
  gas?: number;
  fuzzRuns?: number;
  invariantRuns?: number;
}
interface Report {
  generatedAt: string;
  commit: string;
  node: string;
  totals: { typescript: { passed: number; failed: number; skipped: number; files: number }; foundry: { passed: number; failed: number; skipped: number; suites: number } };
  vitest: Array<{ file: string; tests: T[] }>;
  forge: Array<{ suite: string; tests: T[] }>;
}

function Suite({ title, tests, sub }: { title: string; tests: T[]; sub: string }) {
  const [open, setOpen] = useState(false);
  const failed = tests.filter((t) => t.status === "fail").length;
  return (
    <li className="rounded-xl border border-line bg-white">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${failed ? "bg-rose" : "bg-band-green"}`} />
        <span className="mono min-w-0 flex-1 truncate text-[13px] text-ink">{title}</span>
        <span className="mono shrink-0 text-[11px] text-muted">{sub}</span>
        <span className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <ul className="space-y-1 border-t border-line px-4 py-3">
          {tests.map((t) => (
            <li key={t.name} className="flex gap-2 text-[12px]">
              <span className={t.status === "pass" ? "text-band-green" : t.status === "fail" ? "text-rose" : "text-muted"}>{t.status === "pass" ? "✓" : t.status === "fail" ? "✗" : "–"}</span>
              <span className="min-w-0 flex-1 text-body [overflow-wrap:anywhere]">{t.name}</span>
              <span className="mono shrink-0 text-[10px] text-muted">
                {t.fuzzRuns ? `fuzz ×${t.fuzzRuns}` : t.invariantRuns ? `invariant ×${t.invariantRuns}` : t.gas ? `${t.gas.toLocaleString()} gas` : t.ms !== undefined ? `${t.ms} ms` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Recorded() {
  const [r, setR] = useState<Report | null>();
  useEffect(() => {
    fetch("/test-report.json")
      .then((x) => (x.ok ? x.json() : null))
      .then(setR)
      .catch(() => setR(null));
  }, []);

  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-[20px] border border-line bg-white p-5 sm:p-6">
        <h3 className="text-[18px] font-medium tracking-[-0.01em] text-ink">The repository&apos;s full test suites</h3>
        <p className="mt-1 text-sm leading-relaxed text-body">
          Recorded with <span className="mono">pnpm report:tests</span>: every TypeScript test (including end-to-end runs of control, signer, Steward and the vault on a local anvil chain) and every Foundry test, fuzz
          and invariant run. Run them yourself from a clone with <span className="mono">pnpm test</span> and <span className="mono">pnpm contracts:test</span>.
        </p>
        {r === undefined && <p className="mt-4 text-sm text-muted">Loading…</p>}
        {r === null && <p className="mt-4 text-sm text-muted">No recorded report in this build.</p>}
        {r && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [`${r.totals.typescript.passed}`, "TypeScript tests passed"],
                [`${r.totals.foundry.passed}`, "Foundry tests passed"],
                [`${r.totals.typescript.failed + r.totals.foundry.failed}`, "failed"],
                [r.commit, `commit · ${new Date(r.generatedAt).toLocaleDateString()}`],
              ].map(([v, l]) => (
                <div key={l} className="rounded-xl bg-paper px-4 py-3">
                  <div className="mono text-[20px] text-ink">{v}</div>
                  <div className="text-xs text-muted">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <div>
                <div className="mono mb-2 text-[11px] uppercase tracking-wider text-muted">Foundry · {r.totals.foundry.suites} suites</div>
                <ul className="space-y-2">
                  {r.forge.map((s) => (
                    <Suite key={s.suite} title={s.suite} tests={s.tests} sub={`${s.tests.filter((t) => t.status === "pass").length}/${s.tests.length}`} />
                  ))}
                </ul>
              </div>
              <div>
                <div className="mono mb-2 text-[11px] uppercase tracking-wider text-muted">TypeScript · {r.totals.typescript.files} files</div>
                <ul className="space-y-2">
                  {r.vitest.map((s) => (
                    <Suite key={s.file} title={s.file} tests={s.tests} sub={`${s.tests.filter((t) => t.status === "pass").length}/${s.tests.length}`} />
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="rounded-[20px] border border-line bg-white p-5 sm:p-6">
        <h3 className="text-[18px] font-medium tracking-[-0.01em] text-ink">The attack set: a fully compromised model, 10 attacks, nothing paid</h3>
        <p className="mt-1 text-sm text-body">
          <span className="mono">tyrell attack run</span> scripts the model to take every bait against a live deployment.{" "}
          <a className="text-brand hover:underline" href={`${REPO}#attack-set-t-20`}>
            Results in the README ↗
          </a>
        </p>
        <ul className="mt-4 divide-y divide-line">
          {ATTACKS.map((a, i) => (
            <li key={a.name} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 py-2 text-[13px] sm:grid-cols-[22px_minmax(0,1fr)_auto]">
              <span className="mono text-muted">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-ink">{a.name}</span>
              <span className="mono col-start-2 text-[11px] text-rose sm:col-start-3 sm:text-right">{a.result}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3 rounded-[20px] bg-night p-6 text-snow sm:flex-row sm:items-center">
        <div>
          <div className="text-[17px] font-medium">A full end-to-end run, recorded</div>
          <p className="mt-1 text-sm text-mist">The console replays a run of every process on a local chain: a poisoned token arrives, the payment is refused, the source is quarantined and the clean state comes back.</p>
        </div>
        <Link href="/console" className="shrink-0 whitespace-nowrap rounded-lg bg-brand px-5 py-3 text-center text-[15px] transition-colors hover:bg-brand-deep sm:ml-auto">
          Open the console
        </Link>
      </div>
    </div>
  );
}
