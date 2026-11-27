"use client";

import { useEffect, useMemo, useState } from "react";
import { LineageGraph } from "@/components/LineageGraph";
import { amount, bodyText, CLS_STYLE, graphFor, KIND, LANE_COLOR, SEED_TYPE, short, type ViewDocument, type ViewMemory } from "@/lib/view";

type Tab = "graph" | "blast" | "timeline" | "decisions" | "incidents";

export default function Page() {
  const [view, setView] = useState<ViewDocument>();
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("graph");
  const [seedId, setSeedId] = useState<number>();
  const [selected, setSelected] = useState<string>();

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/view", { cache: "no-store" });
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        setSource(r.headers.get("x-tyrell-source") ?? "");
        setView((await r.json()) as ViewDocument);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const seeds = view?.seeds ?? [];
  useEffect(() => {
    if (seedId === undefined && seeds.length) setSeedId(seeds[0]!.seedId);
  }, [seeds, seedId]);
  const graph = useMemo(() => (view ? graphFor(view, tab === "blast" ? { ...(seedId !== undefined ? { seedId } : {}) } : { last: 60 }) : undefined), [view, tab, seedId]);
  const byId = useMemo(() => new Map((view?.memories ?? []).map((m) => [m.id, m])), [view]);

  if (error && !view) return <Shell><p className="text-rose-700">Could not load the projection: {error}</p></Shell>;
  if (!view || !graph) return <Shell><p className="text-stone-500">Loading…</p></Shell>;

  const counts = view.memories.reduce<Record<string, number>>((a, m) => ((a[m.cls] = (a[m.cls] ?? 0) + 1), a), {});
  const quarantined = view.memories.filter((m) => m.quarantined).length;
  const tx = (h?: string) => (h ? (view.explorer ? <a className="mono text-sky-700 underline" href={`${view.explorer}/tx/${h}`}>{short(h)}</a> : <span className="mono">{short(h)}</span>) : "—");

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold">Tyrell</h1>
          <p className="text-sm text-stone-600">
            {view.network} (chain {view.chainId}) · block {view.head} · {source === "snapshot" ? `snapshot of ${new Date(view.generatedAt).toLocaleString()}` : "live"}
          </p>
        </div>
        <Stat label="memories" value={view.memories.length} />
        {(["trusted", "derived", "untrusted", "unverified"] as const).map((c) => <Stat key={c} label={c} value={counts[c] ?? 0} />)}
        <Stat label="quarantined" value={quarantined} accent={quarantined > 0} />
        <Stat label="decisions" value={view.decisions.length} />
        <div className="text-xs text-stone-500">
          digest <span className="mono">{short(view.digest, 8)}</span>
        </div>
      </div>

      <nav className="mb-4 flex gap-1 border-b border-stone-200">
        {(["graph", "blast", "timeline", "decisions", "incidents"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-stone-900 font-semibold" : "border-transparent text-stone-500 hover:text-stone-800"}`}>
            {{ graph: "Lineage", blast: "Blast radius", timeline: "Timeline", decisions: "Decisions", incidents: `Incidents (${view.incidents.length})` }[t]}
          </button>
        ))}
      </nav>

      {(tab === "graph" || tab === "blast") && (
        <section>
          {tab === "blast" && (
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <label>
                Seed{" "}
                <select className="rounded border border-stone-300 bg-white px-2 py-1" value={seedId ?? ""} onChange={(e) => setSeedId(Number(e.target.value))}>
                  {seeds.map((s) => (
                    <option key={s.seedId} value={s.seedId}>
                      #{s.seedId} {SEED_TYPE[s.type]} {short(s.value, 5)} {s.released ? "(released)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {seeds.length === 0 ? <span className="text-stone-500">No quarantine seeds yet.</span> : <span className="text-stone-600">{graph.memoryIds.length} memories, {graph.decisionIds.length} decisions in the radius</span>}
            </div>
          )}
          <LineageGraph graph={graph} onSelect={setSelected} />
          <Legend />
          {selected && byId.get(selected) && <Detail m={byId.get(selected)!} />}
        </section>
      )}

      {tab === "timeline" && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-stone-500">
            <tr><th className="py-2">Block</th><th>Lane</th><th>Kind</th><th>Class</th><th>Memory</th></tr>
          </thead>
          <tbody>
            {[...view.memories].reverse().map((m) => (
              <tr key={m.id} className={`cursor-pointer border-t border-stone-200 align-top hover:bg-white ${m.quarantined ? "opacity-60" : ""}`} onClick={() => setSelected(m.id)}>
                <td className="mono py-2 pr-3 text-xs">{m.block}</td>
                <td className="pr-3"><span className="font-medium" style={{ color: LANE_COLOR[m.lane] }}>{m.laneName}</span></td>
                <td className="pr-3 text-stone-600">{KIND[m.kind]}</td>
                <td className="pr-3"><Cls m={m} /></td>
                <td className="py-2 text-stone-700">{bodyText(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "decisions" && (
        <div className="space-y-3">
          {[...view.decisions].reverse().map((d) => (
            <div key={d.id} className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
              <div className="mb-1 flex items-center gap-3">
                <span className={`rounded px-2 py-0.5 font-semibold ${d.verdict?.decision === "ALLOW" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{d.verdict?.decision} {d.verdict?.code}</span>
                <span className="text-stone-600">
                  {amount(view, d.proposal?.amount)} → <span className="mono">{short(String(d.proposal?.recipient ?? ""))}</span>
                  {d.proposal?.payeeLabel ? ` (label "${String(d.proposal.payeeLabel)}")` : ""}
                </span>
                <span className="ml-auto text-xs">tx {tx(d.txHash)}</span>
              </div>
              <p className="mb-2 text-stone-600">{d.verdict?.reasons.join("; ")}</p>
              <p className="text-xs text-stone-500">What the model had read (parents = readSet):</p>
              <ul className="mt-1 space-y-1">
                {d.parents.map((p) => {
                  const m = byId.get(p);
                  return m ? (
                    <li key={p} className="flex gap-2 text-xs"><Cls m={m} /><span className="text-stone-700">{bodyText(m).slice(0, 140)}</span></li>
                  ) : (
                    <li key={p} className="mono text-xs text-stone-400">{p}</li>
                  );
                })}
              </ul>
            </div>
          ))}
          {view.decisions.length === 0 && <p className="text-stone-500">No payment proposals yet.</p>}
        </div>
      )}

      {tab === "incidents" && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-stone-500">
            <tr><th className="py-2">Score</th><th>Rules</th><th>Source</th><th>What arrived</th></tr>
          </thead>
          <tbody>
            {[...view.incidents].reverse().map((i) => (
              <tr key={i.memoryId} className="border-t border-stone-200 align-top">
                <td className="py-2 pr-3 font-semibold">{i.score}</td>
                <td className="pr-3 text-stone-600">{i.rules.join(", ")}</td>
                <td className="mono pr-3 text-xs">{short(i.source)}</td>
                <td className="py-2 text-stone-700">{i.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className={`text-xl font-semibold ${accent ? "text-red-700" : ""}`}>{value}</div>
      <div className="text-xs text-stone-500">{label}</div>
    </div>
  );
}

function Cls({ m }: { m: ViewMemory }) {
  return (
    <span className="inline-flex gap-1">
      <span className={`rounded px-1.5 text-xs ${CLS_STYLE[m.cls]}`}>{m.cls}</span>
      {m.quarantined && <span className="rounded bg-red-600 px-1.5 text-xs text-white">quarantined</span>}
    </span>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap gap-4 text-xs text-stone-600">
      {Object.entries({ 1: "user", 2: "agent", 3: "wallet", 4: "control" }).map(([l, n]) => (
        <span key={l} className="flex items-center gap-1"><span className="inline-block h-3 w-1" style={{ background: LANE_COLOR[Number(l)] }} />{n} lane</span>
      ))}
      <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm outline-2 outline-dashed outline-red-600" />quarantined</span>
      <span>dashed edges: source → memory; solid: parent → child</span>
    </div>
  );
}

function Detail({ m }: { m: ViewMemory }) {
  return (
    <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="mono text-xs">{m.id}</span>
        <Cls m={m} />
        <span className="text-stone-500">{m.laneName} · {KIND[m.kind]} · block {m.block} · {m.verification}</span>
      </div>
      <p className="mb-2 whitespace-pre-wrap text-stone-800">{m.body ?? "(body unavailable)"}</p>
      <p className="text-xs text-stone-500">Class: {m.clsReason}{m.seeds.length ? ` · seeds ${m.seeds.join(", ")}` : ""} · signer <span className="mono">{m.signer}</span> · cid <span className="mono">{m.cid}</span></p>
    </div>
  );
}
