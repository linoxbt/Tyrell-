"use client";

import { useEffect, useMemo, useState } from "react";
import { LineageGraph } from "@/components/LineageGraph";
import { Bars } from "@/components/argus/ui";
import { kpis, ruleTrace } from "@/lib/kpis";
import { amount, bodyText, CLS_STYLE, graphFor, KIND, LANE_COLOR, SEED_TYPE, short, type ViewDecision, type ViewDocument, type ViewMemory } from "@/lib/view";

/*
 * The full view of a Tyrell account, built from control's projection (memories with their bodies,
 * lineage, decisions, incidents). The console shows it for your own control process; the playground
 * shows it for a recorded run.
 */

export type ProjectionTab = "overview" | "graph" | "blast" | "decisions" | "timeline" | "incidents";

export function ProjectionBody({ view, tab }: { view: ViewDocument; tab: ProjectionTab }) {
  const [seedId, setSeedId] = useState<number>();
  const [selected, setSelected] = useState<string>();
  const seeds = view.seeds ?? [];
  useEffect(() => {
    if (seedId === undefined && seeds.length) setSeedId(seeds.filter((s) => !s.released).at(-1)?.seedId ?? seeds[0]!.seedId);
  }, [seeds, seedId]);
  const graph = useMemo(() => graphFor(view, tab === "blast" ? { ...(seedId !== undefined ? { seedId } : {}) } : { last: 60 }), [view, tab, seedId]);
  const byId = useMemo(() => new Map(view.memories.map((m) => [m.id, m])), [view]);
  return (
    <>
      {tab === "overview" && <Overview view={view} onSelect={setSelected} />}

      {(tab === "graph" || tab === "blast") && (
        <section className="rounded-xl border border-line bg-white p-3 sm:p-4">
          {tab === "blast" && (
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-body">
              <label className="flex items-center gap-2">
                Seed
                <select className="rounded-lg border border-line bg-white px-3 py-1.5 text-ink" value={seedId ?? ""} onChange={(e) => setSeedId(Number(e.target.value))}>
                  {seeds.map((s) => (
                    <option key={s.seedId} value={s.seedId}>
                      #{s.seedId} {SEED_TYPE[s.type]} {short(s.value, 5)} {s.released ? "(released)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {seeds.length === 0 ? (
                <span className="text-muted">No quarantine seeds yet.</span>
              ) : (
                <span>
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
  );
}

function Overview({ view, onSelect }: { view: ViewDocument; onSelect: (id: string) => void }) {
  const last = [...view.decisions].reverse()[0];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 xl:grid-cols-4">
        {kpis(view).map((c) => (
          <div key={c.label} className="min-w-0 rounded-xl border border-line bg-white px-4 py-3.5 sm:px-5 sm:py-4">
            <div className="flex flex-col gap-0.5 text-[13px] text-body sm:flex-row sm:items-center sm:justify-between">
              {c.label}
              <span className={`mono text-[11px] ${c.noteColor}`}>{c.note}</span>
            </div>
            <div className="mt-2 text-[26px] font-medium tracking-tight text-ink sm:text-[30px]">{c.value}</div>
            <div className="mt-2">
              <Bars values={c.bars} color={c.color} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {last && (
            <Panel title="Policy trace · latest decision">
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="mono text-ink">{short(last.id, 4)}</span>
                <Verdict d={last} />
                <span className="mono ml-auto text-xs text-body">{last.parents.length} memories read · {amount(view, last.proposal?.amount)}</span>
              </div>
              <div className="space-y-2.5">
                {ruleTrace(last).map((r) => (
                  <div key={r.id} className="grid grid-cols-[minmax(0,118px)_1fr_34px] items-center gap-2.5 sm:grid-cols-[170px_1fr_40px] sm:gap-3">
                    <span className="mono truncate text-[12px] text-body">{r.id} {r.name}</span>
                    <span className="h-2.5 rounded-full bg-paper">
                      <span className="block h-full rounded-full" style={{ width: r.state === "skip" ? "0%" : "100%", background: r.state === "pass" ? "#7c5cff" : "#ff5c7a" }} />
                    </span>
                    <span className={`mono text-right text-[11px] ${r.state === "fail" ? "text-rose" : r.state === "pass" ? "text-brand" : "text-muted"}`}>{r.state}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="Latest decisions">
            <Decisions view={view} byId={new Map(view.memories.map((m) => [m.id, m]))} limit={3} compact />
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Payees">
            <ul className="divide-y divide-line text-sm">
              {view.payees.map((p) => (
                <li key={p.payeeId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="font-medium text-ink">{p.label}</span>
                  <span className="mono text-xs text-muted">{short(p.addr, 4)}</span>
                  <span className="ml-auto text-xs text-muted">
                    cap {amount(view, p.capPerTx)} / day {amount(view, p.capPerDay)}
                  </span>
                  {p.suspended ? <Pill c="bg-[#ffe9ed] text-rose">suspended</Pill> : !p.active ? <Pill c="bg-paper text-muted">removed</Pill> : <Pill c="bg-[#e6f7f0] text-band-green">active</Pill>}
                </li>
              ))}
              {view.payees.length === 0 && <li className="py-2 text-muted">No payees registered.</li>}
            </ul>
          </Panel>
          <Panel title="Quarantine seeds">
            <ul className="divide-y divide-line text-sm">
              {view.seeds.map((s) => (
                <li key={s.seedId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="mono text-xs text-ink">#{s.seedId}</span>
                  <span className="text-body">{SEED_TYPE[s.type]}</span>
                  <span className="mono text-xs text-muted">{short(s.value, 5)}</span>
                  <span className="ml-auto text-xs text-muted">{view.memories.filter((m) => m.seeds.includes(s.seedId)).length} memories</span>
                  {s.released ? <Pill c="bg-paper text-muted">released</Pill> : <Pill c="bg-brand-50 text-brand">active</Pill>}
                </li>
              ))}
              {view.seeds.length === 0 && <li className="py-2 text-muted">No seeds.</li>}
            </ul>
          </Panel>
          <Panel title="Recent memories">
            <ul className="space-y-2 text-sm">
              {view.memories.slice(-5).reverse().map((m) => (
                <li key={m.id} className="flex min-w-0 cursor-pointer items-center gap-2" onClick={() => onSelect(m.id)}>
                  <Cls m={m} />
                  <span className="truncate text-body">{bodyText(m)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Verdict({ d }: { d: ViewDecision }) {
  return (
    <span className={`mono rounded-full px-2.5 py-0.5 text-[11px] font-medium ${d.verdict?.decision === "ALLOW" ? "bg-[#e6f7f0] text-band-green" : "bg-[#ffe9ed] text-rose"}`}>
      {d.verdict?.decision} {d.verdict?.code}
    </span>
  );
}

function Decisions({ view, byId, limit, compact }: { view: ViewDocument; byId: Map<string, ViewMemory>; limit?: number; compact?: boolean }) {
  const tx = (h?: string) =>
    h ? (view.explorer ? <a className="mono text-brand underline" href={`${view.explorer}/tx/${h}`}>{short(h)}</a> : <span className="mono">{short(h)}</span>) : <span className="text-muted">no transaction</span>;
  const list = [...view.decisions].reverse().slice(0, limit ?? view.decisions.length);
  return (
    <div className="space-y-3">
      {list.map((d) => (
        <div key={d.id} className={`rounded-xl border border-line bg-white ${compact ? "p-4" : "p-5"} text-sm`}>
          <div className="mb-1 flex flex-wrap items-center gap-3">
            <Verdict d={d} />
            <span className="text-body">
              {amount(view, d.proposal?.amount)} → <span className="mono">{short(String(d.proposal?.recipient ?? ""))}</span>
              {d.proposal?.payeeLabel ? ` (label "${String(d.proposal.payeeLabel)}")` : ""}
            </span>
            <span className="ml-auto text-xs">{tx(d.txHash)}</span>
          </div>
          <p className="mb-2 text-muted">{d.verdict?.reasons.join("; ")}</p>
          <p className="text-xs text-muted">What the model had read (parents = readSet)</p>
          <ul className="mt-1.5 space-y-1">
            {d.parents.map((p) => {
              const m = byId.get(p);
              return m ? (
                <li key={p} className="flex min-w-0 gap-2 text-xs">
                  <Cls m={m} />
                  <span className="truncate text-body">{bodyText(m).slice(0, 140)}</span>
                </li>
              ) : (
                <li key={p} className="mono text-xs text-muted">{p}</li>
              );
            })}
          </ul>
        </div>
      ))}
      {view.decisions.length === 0 && <p className="text-muted">No payment proposals yet.</p>}
    </div>
  );
}

function Timeline({ view, onSelect }: { view: ViewDocument; onSelect: (id: string) => void }) {
  const rows = [...view.memories].reverse();
  return (
    <>
      {/* phones: one card per memory */}
      <ul className="space-y-2.5 sm:hidden">
        {rows.map((m) => (
          <li key={m.id}>
            <button onClick={() => onSelect(m.id)} className={`w-full rounded-xl border border-line bg-white p-3.5 text-left transition-colors active:bg-paper ${m.quarantined ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-medium" style={{ color: LANE_COLOR[m.lane] }}>{m.laneName}</span>
                <span className="text-muted">{KIND[m.kind]}</span>
                <span className="mono text-muted">#{m.block}</span>
                <span className="ml-auto"><Cls m={m} /></span>
              </div>
              <p className="mt-2 line-clamp-3 text-sm text-body">{bodyText(m)}</p>
            </button>
          </li>
        ))}
      </ul>
      {/* tablets and up: the table */}
      <div className="hidden overflow-hidden rounded-xl border border-line bg-white sm:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-paper text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Block</th>
              <th>Lane</th>
              <th>Kind</th>
              <th>Class</th>
              <th className="pr-4">Memory</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className={`cursor-pointer border-t border-line align-top transition-colors hover:bg-paper ${m.quarantined ? "opacity-60" : ""}`} onClick={() => onSelect(m.id)}>
                <td className="mono px-4 py-2.5 text-xs">{m.block}</td>
                <td className="pr-3">
                  <span className="font-medium" style={{ color: LANE_COLOR[m.lane] }}>{m.laneName}</span>
                </td>
                <td className="pr-3 text-body">{KIND[m.kind]}</td>
                <td className="pr-3"><Cls m={m} /></td>
                <td className="py-2.5 pr-4 text-body">{bodyText(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Incidents({ view }: { view: ViewDocument }) {
  return (
    <div className="space-y-3">
      {[...view.incidents].reverse().map((i) => (
        <div key={i.memoryId} className="flex gap-3 rounded-xl border border-line bg-white p-4 text-sm sm:gap-4 sm:p-5">
          <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg font-semibold ${i.score >= 80 ? "bg-[#ffe9ed] text-rose" : "bg-tint-peach text-[#b26a00]"}`}>{i.score}</div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5">
              {i.rules.map((r) => (
                <span key={r} className="rounded-md bg-paper px-2 py-0.5 text-xs text-body">{r}</span>
              ))}
              <span className="mono text-xs text-muted">source {short(i.source)}</span>
            </div>
            <p className="mt-2 text-body">{i.summary}</p>
            {i.ai && (
              <p className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-[13px] text-ink">
                <span className="rounded bg-brand px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">AI</span>
                <span>{i.ai.injection ? `${i.ai.category.replace("_", " ")} · ${Math.round(i.ai.confidence * 100)}%` : "judged benign"}</span>
                {i.ai.reason && <span className="text-body">“{i.ai.reason}”</span>}
                <span className="mono text-[11px] text-muted">{i.ai.model}</span>
              </p>
            )}
          </div>
        </div>
      ))}
      {view.incidents.length === 0 && <p className="text-muted">No incidents.</p>}
    </div>
  );
}

const Pill = ({ c, children }: { c: string; children: React.ReactNode }) => <span className={`rounded-md px-2 py-0.5 text-xs ${c}`}>{children}</span>;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h3 className="mb-3 mono text-[12px] uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Cls({ m }: { m: ViewMemory }) {
  return (
    <span className="inline-flex shrink-0 gap-1">
      <span className={`rounded-md px-1.5 text-xs ${CLS_STYLE[m.cls]}`}>{m.cls}</span>
      {m.quarantined && <span className="rounded-md bg-rose px-1.5 text-xs text-white">quarantined</span>}
    </span>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-4 text-xs text-body">
      {Object.entries({ 1: "user", 2: "agent", 3: "wallet", 4: "control" }).map(([l, n]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-1 rounded" style={{ background: LANE_COLOR[Number(l)] }} />
          {n} lane
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm outline-2 outline-dashed outline-rose" />
        quarantined
      </span>
      <span>dashed edges: source → memory · solid: parent → child</span>
    </div>
  );
}

function Detail({ m, onClose }: { m: ViewMemory; onClose: () => void }) {
  return (
    <div className="mt-6 rounded-xl border border-line bg-white p-4 text-sm sm:p-5">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="mono text-xs">{m.id}</span>
        <Cls m={m} />
        <span className="text-muted">
          {m.laneName} · {KIND[m.kind]} · block {m.block} · {m.verification}
        </span>
        <button className="ml-auto text-muted hover:text-ink" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="mb-2 whitespace-pre-wrap text-ink">{m.body ?? "(body unavailable)"}</p>
      <p className="text-xs text-muted">
        Class: {m.clsReason}
        {m.seeds.length ? ` · seeds ${m.seeds.join(", ")}` : ""} · signer <span className="mono">{m.signer}</span> · cid <span className="mono">{m.cid}</span>
      </p>
    </div>
  );
}
