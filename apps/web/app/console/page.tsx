"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LineageGraph } from "@/components/LineageGraph";
import { Mark } from "@/components/Logo";
import { useView } from "@/lib/useView";
import { amount, bodyText, CLS_STYLE, graphFor, KIND, LANE_COLOR, SEED_TYPE, short, type ViewDocument, type ViewMemory } from "@/lib/view";

type Tab = "overview" | "graph" | "blast" | "decisions" | "timeline" | "incidents";
const TABS: Array<[Tab, string, string]> = [
  ["overview", "Overview", "◎"],
  ["graph", "Lineage", "⌘"],
  ["blast", "Blast radius", "◇"],
  ["decisions", "Decisions", "⛨"],
  ["timeline", "Timeline", "≡"],
  ["incidents", "Incidents", "⚑"],
];

export default function Console() {
  const { view, source, error } = useView(15_000);
  const [tab, setTab] = useState<Tab>("overview");
  const [seedId, setSeedId] = useState<number>();
  const [selected, setSelected] = useState<string>();
  const seeds = view?.seeds ?? [];
  useEffect(() => {
    if (seedId === undefined && seeds.length) setSeedId(seeds.filter((s) => !s.released).at(-1)?.seedId ?? seeds[0]!.seedId);
  }, [seeds, seedId]);
  const graph = useMemo(() => (view ? graphFor(view, tab === "blast" ? { ...(seedId !== undefined ? { seedId } : {}) } : { last: 60 }) : undefined), [view, tab, seedId]);
  const byId = useMemo(() => new Map((view?.memories ?? []).map((m) => [m.id, m])), [view]);

  return (
    <div className="grid min-h-screen grid-cols-[232px_1fr] bg-stone-50">
      <aside className="sticky top-0 flex h-screen flex-col border-r border-line bg-white px-3 py-5">
        <Link href="/" className="mb-8 flex items-center gap-2 px-2">
          <Mark size={26} />
          <span className="text-lg font-semibold tracking-tight">Tyrell</span>
        </Link>
        <div className="px-2 text-[11px] uppercase tracking-wider text-stone-400">Steward</div>
        <nav className="mt-2 space-y-0.5">
          {TABS.map(([t, label, icon]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${tab === t ? "bg-brand-50 font-medium text-brand" : "text-stone-600 hover:bg-stone-50"}`}
            >
              <span className="w-4 text-center">{icon}</span>
              {label}
              {t === "incidents" && view && <span className="ml-auto rounded-full bg-stone-100 px-2 text-[11px] text-stone-600">{view.incidents.length}</span>}
            </button>
          ))}
        </nav>
        {view && (
          <div className="mt-auto space-y-2 rounded-xl border border-line p-3 text-xs text-stone-500">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${source === "live" ? "bg-emerald-500" : "bg-amber-400"}`} />
              {source === "live" ? "live from control" : "read-only snapshot"}
            </div>
            <div className="mono">digest {short(view.digest, 5)}</div>
            <div>
              {view.network} · chain {view.chainId}
            </div>
          </div>
        )}
      </aside>

      <main className="min-w-0">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-white/90 px-8 py-4 backdrop-blur">
          <span className="text-lg font-semibold">steward</span>
          <span className="text-stone-400">/ {TABS.find((t) => t[0] === tab)![1].toLowerCase()}</span>
          {view && (
            <>
              <span className="ml-auto flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-stone-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {view.network}
              </span>
              <span className="mono rounded-full border border-line px-3 py-1 text-xs text-stone-600">block {view.head}</span>
              {source === "snapshot" && <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800">snapshot of {new Date(view.generatedAt).toLocaleString()}</span>}
            </>
          )}
        </header>

        <div className="px-8 py-7">
          {error && !view && <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">Could not load the projection: {error}</p>}
          {!view && !error && <p className="text-stone-500">Loading…</p>}
          {view && graph && (
            <>
              {tab === "overview" && <Overview view={view} onSelect={(id) => { setSelected(id); }} />}

              {(tab === "graph" || tab === "blast") && (
                <section>
                  {tab === "blast" && (
                    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                      <label className="flex items-center gap-2">
                        Seed
                        <select className="rounded-lg border border-line bg-white px-3 py-1.5" value={seedId ?? ""} onChange={(e) => setSeedId(Number(e.target.value))}>
                          {seeds.map((s) => (
                            <option key={s.seedId} value={s.seedId}>
                              #{s.seedId} {SEED_TYPE[s.type]} {short(s.value, 5)} {s.released ? "(released)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      {seeds.length === 0 ? (
                        <span className="text-stone-500">No quarantine seeds yet.</span>
                      ) : (
                        <span className="text-stone-600">
                          {graph.memoryIds.length} memories, {graph.decisionIds.length} decisions in the radius
                        </span>
                      )}
                    </div>
                  )}
                  <LineageGraph graph={graph} onSelect={setSelected} />
                  <Legend />
                </section>
              )}

              {tab === "decisions" && <Decisions view={view} byId={byId} />}
              {tab === "timeline" && <Timeline view={view} onSelect={setSelected} />}
              {tab === "incidents" && <Incidents view={view} />}

              {selected && byId.get(selected) && <Detail m={byId.get(selected)!} onClose={() => setSelected(undefined)} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Overview({ view, onSelect }: { view: ViewDocument; onSelect: (id: string) => void }) {
  const counts = view.memories.reduce<Record<string, number>>((a, m) => ((a[m.cls] = (a[m.cls] ?? 0) + 1), a), {});
  const q = view.memories.filter((m) => m.quarantined).length;
  const stats: Array<[string, number, string]> = [
    ["memories", view.memories.length, ""],
    ["trusted", counts.trusted ?? 0, "text-emerald-700"],
    ["derived", counts.derived ?? 0, "text-sky-700"],
    ["untrusted", counts.untrusted ?? 0, "text-amber-700"],
    ["unverified", counts.unverified ?? 0, "text-rose-700"],
    ["quarantined", q, "text-rose-600"],
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {stats.map(([l, v, c]) => (
          <div key={l} className="rounded-2xl border border-line bg-white px-5 py-4">
            <div className={`text-3xl font-semibold tracking-tight ${c}`}>{v}</div>
            <div className="text-xs text-stone-500">{l}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Latest decisions">
          <Decisions view={view} byId={new Map(view.memories.map((m) => [m.id, m]))} limit={3} compact />
        </Panel>
        <div className="space-y-6">
          <Panel title="Payees">
            <ul className="divide-y divide-line text-sm">
              {view.payees.map((p) => (
                <li key={p.payeeId} className="flex items-center gap-3 py-2.5">
                  <span className="font-medium">{p.label}</span>
                  <span className="mono text-xs text-stone-500">{short(p.addr, 4)}</span>
                  <span className="ml-auto text-xs text-stone-500">
                    cap {amount(view, p.capPerTx)} / day {amount(view, p.capPerDay)}
                  </span>
                  {p.suspended ? <Pill c="bg-rose-50 text-rose-700">suspended</Pill> : !p.active ? <Pill c="bg-stone-100 text-stone-600">removed</Pill> : <Pill c="bg-emerald-50 text-emerald-700">active</Pill>}
                </li>
              ))}
              {view.payees.length === 0 && <li className="py-2 text-stone-500">No payees registered.</li>}
            </ul>
          </Panel>
          <Panel title="Quarantine seeds">
            <ul className="divide-y divide-line text-sm">
              {view.seeds.map((s) => (
                <li key={s.seedId} className="flex items-center gap-3 py-2.5">
                  <span className="mono text-xs">#{s.seedId}</span>
                  <span>{SEED_TYPE[s.type]}</span>
                  <span className="mono text-xs text-stone-500">{short(s.value, 5)}</span>
                  <span className="ml-auto text-xs text-stone-500">{view.memories.filter((m) => m.seeds.includes(s.seedId)).length} memories</span>
                  {s.released ? <Pill c="bg-stone-100 text-stone-600">released</Pill> : <Pill c="bg-rose-50 text-rose-700">active</Pill>}
                </li>
              ))}
              {view.seeds.length === 0 && <li className="py-2 text-stone-500">No seeds.</li>}
            </ul>
          </Panel>
          <Panel title="Recent memories">
            <ul className="space-y-2 text-sm">
              {view.memories.slice(-5).reverse().map((m) => (
                <li key={m.id} className="flex min-w-0 cursor-pointer items-center gap-2" onClick={() => onSelect(m.id)}>
                  <Cls m={m} />
                  <span className="truncate text-stone-600">{bodyText(m)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Decisions({ view, byId, limit, compact }: { view: ViewDocument; byId: Map<string, ViewMemory>; limit?: number; compact?: boolean }) {
  const tx = (h?: string) =>
    h ? (view.explorer ? <a className="mono text-brand underline" href={`${view.explorer}/tx/${h}`}>{short(h)}</a> : <span className="mono">{short(h)}</span>) : <span className="text-stone-400">no transaction</span>;
  const list = [...view.decisions].reverse().slice(0, limit ?? view.decisions.length);
  return (
    <div className="space-y-3">
      {list.map((d) => (
        <div key={d.id} className={`rounded-2xl border border-line bg-white ${compact ? "p-4" : "p-5"} text-sm`}>
          <div className="mb-1 flex flex-wrap items-center gap-3">
            <span className={`rounded-md px-2 py-0.5 font-semibold ${d.verdict?.decision === "ALLOW" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
              {d.verdict?.decision} {d.verdict?.code}
            </span>
            <span className="text-stone-600">
              {amount(view, d.proposal?.amount)} → <span className="mono">{short(String(d.proposal?.recipient ?? ""))}</span>
              {d.proposal?.payeeLabel ? ` (label "${String(d.proposal.payeeLabel)}")` : ""}
            </span>
            <span className="ml-auto text-xs">{tx(d.txHash)}</span>
          </div>
          <p className="mb-2 text-stone-500">{d.verdict?.reasons.join("; ")}</p>
          <p className="text-xs text-stone-400">What the model had read (parents = readSet)</p>
          <ul className="mt-1.5 space-y-1">
            {d.parents.map((p) => {
              const m = byId.get(p);
              return m ? (
                <li key={p} className="flex min-w-0 gap-2 text-xs">
                  <Cls m={m} />
                  <span className="truncate text-stone-700">{bodyText(m).slice(0, 140)}</span>
                </li>
              ) : (
                <li key={p} className="mono text-xs text-stone-400">{p}</li>
              );
            })}
          </ul>
        </div>
      ))}
      {view.decisions.length === 0 && <p className="text-stone-500">No payment proposals yet.</p>}
    </div>
  );
}

function Timeline({ view, onSelect }: { view: ViewDocument; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase text-stone-500">
          <tr>
            <th className="px-4 py-3">Block</th>
            <th>Lane</th>
            <th>Kind</th>
            <th>Class</th>
            <th className="pr-4">Memory</th>
          </tr>
        </thead>
        <tbody>
          {[...view.memories].reverse().map((m) => (
            <tr key={m.id} className={`cursor-pointer border-t border-line align-top hover:bg-stone-50 ${m.quarantined ? "opacity-60" : ""}`} onClick={() => onSelect(m.id)}>
              <td className="mono px-4 py-2.5 text-xs">{m.block}</td>
              <td className="pr-3">
                <span className="font-medium" style={{ color: LANE_COLOR[m.lane] }}>{m.laneName}</span>
              </td>
              <td className="pr-3 text-stone-600">{KIND[m.kind]}</td>
              <td className="pr-3"><Cls m={m} /></td>
              <td className="py-2.5 pr-4 text-stone-700">{bodyText(m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Incidents({ view }: { view: ViewDocument }) {
  return (
    <div className="space-y-3">
      {[...view.incidents].reverse().map((i) => (
        <div key={i.memoryId} className="flex gap-4 rounded-2xl border border-line bg-white p-5 text-sm">
          <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg font-semibold ${i.score >= 80 ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>{i.score}</div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5">
              {i.rules.map((r) => (
                <span key={r} className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{r}</span>
              ))}
              <span className="mono text-xs text-stone-400">source {short(i.source)}</span>
            </div>
            <p className="mt-2 text-stone-700">{i.summary}</p>
          </div>
        </div>
      ))}
      {view.incidents.length === 0 && <p className="text-stone-500">No incidents.</p>}
    </div>
  );
}

const Pill = ({ c, children }: { c: string; children: React.ReactNode }) => <span className={`rounded-md px-2 py-0.5 text-xs ${c}`}>{children}</span>;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h3 className="mb-3 text-sm font-medium text-stone-500">{title}</h3>
      {children}
    </section>
  );
}

function Cls({ m }: { m: ViewMemory }) {
  return (
    <span className="inline-flex shrink-0 gap-1">
      <span className={`rounded-md px-1.5 text-xs ${CLS_STYLE[m.cls]}`}>{m.cls}</span>
      {m.quarantined && <span className="rounded-md bg-rose-600 px-1.5 text-xs text-white">quarantined</span>}
    </span>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-4 text-xs text-stone-600">
      {Object.entries({ 1: "user", 2: "agent", 3: "wallet", 4: "control" }).map(([l, n]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-1 rounded" style={{ background: LANE_COLOR[Number(l)] }} />
          {n} lane
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm outline-2 outline-dashed outline-rose-600" />
        quarantined
      </span>
      <span>dashed edges: source → memory · solid: parent → child</span>
    </div>
  );
}

function Detail({ m, onClose }: { m: ViewMemory; onClose: () => void }) {
  return (
    <div className="mt-6 rounded-2xl border border-line bg-white p-5 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="mono text-xs">{m.id}</span>
        <Cls m={m} />
        <span className="text-stone-500">
          {m.laneName} · {KIND[m.kind]} · block {m.block} · {m.verification}
        </span>
        <button className="ml-auto text-stone-400 hover:text-ink" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="mb-2 whitespace-pre-wrap text-stone-800">{m.body ?? "(body unavailable)"}</p>
      <p className="text-xs text-stone-500">
        Class: {m.clsReason}
        {m.seeds.length ? ` · seeds ${m.seeds.join(", ")}` : ""} · signer <span className="mono">{m.signer}</span> · cid <span className="mono">{m.cid}</span>
      </p>
    </div>
  );
}
