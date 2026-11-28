"use client";

import { useRef, useState } from "react";
import type { Group, Result } from "@/lib/playground/suite";
import { CLAIMS } from "@/lib/playground/plain";

/** "Don't take our word for it": the 38 contract checks, grouped by the claim each group proves. */
export function Proof() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(38);
  const [results, setResults] = useState<Result[]>([]);
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [ms, setMs] = useState(0);
  const busy = useRef(false);

  const [error, setError] = useState<string>();

  async function start() {
    if (busy.current) return;
    busy.current = true;
    setState("running");
    setError(undefined);
    setResults([]);
    try {
      const mod = await import("@/lib/playground/suite");
      setGroups(mod.GROUPS);
      setTotal(mod.TOTAL);
      const t0 = performance.now();
      const r = await mod.runSuite((x) => setResults((prev) => [...prev, x]));
      setResults(r.results);
      setMs(Math.round(performance.now() - t0));
      setState("done");
    } catch (e) {
      // a failed download or an engine error must never leave the button stuck on "Checking…"
      setError((e as Error).message || String(e));
      setState("idle");
    } finally {
      busy.current = false;
    }
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;

  return (
    <section>
      <h2 className="text-[22px] font-medium tracking-[-0.01em] text-ink sm:text-[26px]">Don&apos;t take our word for it</h2>
      <p className="mt-2 max-w-[640px] text-[15px] leading-relaxed text-body">
        Tyrell&apos;s protections are smart contracts on the QIE blockchain. Press the button to run {total} checks against the exact contract code, right here in your browser. It takes about a second.
      </p>

      <div className="mt-5 rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center gap-4">
          <button onClick={start} disabled={state === "running"} className="rounded-xl bg-ink px-5 py-2.5 text-[15px] font-medium text-white transition-opacity disabled:opacity-60">
            {state === "idle" ? `Run the ${total} checks` : state === "running" ? "Checking…" : "Run them again"}
          </button>
          {state !== "idle" && (
            <div className="text-[15px]">
              <span className={failed ? "text-rose" : "text-band-green"}>
                {passed} of {total} passed
              </span>
              {state === "done" && <span className="text-muted"> · {(ms / 1000).toFixed(1)}s</span>}
            </div>
          )}
        </div>
        {error && <p className="mt-3 rounded-lg bg-[#ffe9ed] px-3 py-2 text-[13px] text-rose">The checks could not run: {error}. Press the button to try again.</p>}
        {state !== "idle" && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-paper">
            <div className={`h-full rounded-full transition-[width] duration-200 ${failed ? "bg-rose" : "bg-band-green"}`} style={{ width: `${(results.length / total) * 100}%` }} />
          </div>
        )}

        <ul className="mt-5 divide-y divide-line">
          {(groups.length ? groups.map((g) => g.id) : Object.keys(CLAIMS)).map((id) => {
            const g = groups.find((x) => x.id === id);
            const rs = results.filter((r) => r.group === id);
            const n = g?.tests.length;
            const done = n !== undefined && rs.length === n;
            const bad = rs.some((r) => r.status === "fail");
            const c = CLAIMS[id]!;
            return (
              <li key={id} className="py-3.5">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-start gap-3">
                    <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] ${bad ? "bg-rose text-white" : done ? "bg-band-green text-white" : "bg-paper text-muted"}`}>{bad ? "✕" : done ? "✓" : "·"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-ink">{c.title}</span>
                      <span className="block text-[13px] leading-relaxed text-body">{c.text}</span>
                    </span>
                    <span className="shrink-0 text-[12px] text-muted">
                      {n !== undefined && rs.length ? `${rs.filter((r) => r.status === "pass").length}/${n}` : ""} <span className="inline-block transition-transform group-open:rotate-180">⌄</span>
                    </span>
                  </summary>
                  <ul className="mt-3 space-y-1.5 pl-9 text-[13px]">
                    {(g?.tests ?? []).map((t) => {
                      const r = rs.find((x) => x.name === t.name);
                      return (
                        <li key={t.name} className="flex gap-2">
                          <span className={r ? (r.status === "pass" ? "text-band-green" : "text-rose") : "text-muted"}>{r ? (r.status === "pass" ? "✓" : "✕") : "·"}</span>
                          <span className="text-body">
                            {t.name}
                            {r?.error && <span className="block text-rose">{r.error}</span>}
                          </span>
                        </li>
                      );
                    })}
                    {!g && <li className="text-muted">Run the checks to see each one.</li>}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
