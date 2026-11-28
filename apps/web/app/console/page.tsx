"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LineageGraph } from "@/components/LineageGraph";
import { Bars, Icon } from "@/components/argus/ui";
import { Mark } from "@/components/Logo";
import { OwnerPanel } from "@/components/wallet/OwnerPanel";
import { ConnectButton } from "@/components/wallet/Wallet";
import { kpis, ruleTrace } from "@/lib/kpis";
import { useView } from "@/lib/useView";
import { amount, bodyText, CLS_STYLE, graphFor, KIND, LANE_COLOR, SEED_TYPE, short, type ViewDecision, type ViewDocument, type ViewMemory } from "@/lib/view";

type Tab = "overview" | "graph" | "blast" | "decisions" | "timeline" | "incidents" | "account";
type IconName = Parameters<typeof Icon>[0]["name"];
const TABS: Array<[Tab, string, IconName]> = [
  ["overview", "Overview", "pulse"],
  ["graph", "Lineage", "graph"],
  ["blast", "Blast radius", "shield"],
  ["decisions", "Decisions", "coin"],
  ["timeline", "Timeline", "list"],
  ["incidents", "Incidents", "flag"],
  ["account", "Account", "gear"],
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

  const [menu, setMenu] = useState(false);
  // an incident opens as its own page (?incident=<memory id>), so the back button returns to the list
  const [incident, setIncident] = useState<string>();
  useEffect(() => {
    const read = () => {
      const id = new URLSearchParams(window.location.search).get("incident") ?? undefined;
      setIncident(id);
      if (id) setTab("incidents");
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const openIncident = (id?: string) => {
    window.history.pushState(null, "", id ? `?incident=${encodeURIComponent(id)}` : window.location.pathname);
    setIncident(id);
    window.scrollTo({ top: 0 });
  };
  const label = TABS.find((t) => t[0] === tab)![1];
  const go = (t: Tab) => {
    if (incident) openIncident(undefined);
    setTab(t);
    setMenu(false);
  };
  const navItems = () =>
    TABS.map(([t, l, icon]) => {
      const active = tab === t;
      const count = t === "incidents" && view ? view.incidents.length : 0;
      return (
        <button
          key={t}
          onClick={() => go(t)}
          aria-current={active ? "page" : undefined}
          className={`relative flex w-[60px] flex-col items-center gap-1 rounded-lg py-2 text-[10.5px] leading-none transition-colors ${active ? "bg-brand-50 text-brand" : "text-muted hover:bg-paper hover:text-ink"}`}
        >
          <Icon name={icon} />
          <span className="whitespace-nowrap">{l}</span>
          {count > 0 && <span className="mono absolute right-1.5 top-1 min-w-4 rounded-full bg-rose px-1 text-[9px] leading-4 text-white">{count}</span>}
        </button>
      );
    });

  // The Argus product dashboard: a slim labelled rail, always on desktop and behind the menu button on phones.
  return (
    <div className="grid min-h-screen grid-cols-[minmax(0,1fr)] bg-[#f7f8fa] md:grid-cols-[76px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col items-center gap-1 overflow-y-auto border-r border-line bg-white py-4 md:flex">
        <Link href="/" aria-label="Tyrell home" className="mb-4">
          <Mark size={28} />
        </Link>
        <nav className="flex flex-col items-center gap-1" aria-label="Console">
          {navItems()}
        </nav>
      </aside>

      <main className="min-w-0">
        <header className="sticky top-0 z-10 border-b border-line bg-white/90 px-4 py-3 backdrop-blur-md sm:px-8 sm:py-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setMenu(true)} className="-ml-1.5 grid h-10 w-10 place-items-center rounded-lg text-ink hover:bg-paper md:hidden" aria-label="Open menu" aria-expanded={menu}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <span className="text-lg font-medium text-ink">{label}</span>
            <ConnectButton className="ml-auto hidden sm:flex" />
            <ConnectButton variant="icon" className="-mr-2 ml-auto sm:hidden" />
          </div>
        </header>

        {/* phone menu */}
        <div className={`fixed inset-0 z-50 transition-[visibility] duration-300 md:hidden ${menu ? "visible" : "pointer-events-none invisible"}`}>
          <div onClick={() => setMenu(false)} className={`absolute inset-0 bg-ink/30 transition-opacity duration-300 ${menu ? "opacity-100" : "opacity-0"}`} />
          <div className={`absolute inset-y-0 left-0 flex w-[84px] flex-col items-center gap-1 overflow-y-auto border-r border-line bg-white pb-6 pt-4 shadow-xl transition-transform duration-300 ${menu ? "translate-x-0" : "-translate-x-full"}`}>
            <Link href="/" aria-label="Tyrell home" onClick={() => setMenu(false)} className="mb-4">
              <Mark size={28} />
            </Link>
            <nav className="flex flex-col items-center gap-1" aria-label="Console">
              {navItems()}
            </nav>
          </div>
        </div>

        <div className="px-4 py-5 [overflow-wrap:anywhere] sm:px-8 sm:py-7">
          {error && !view && <p className="rounded-xl border border-rose/30 bg-[#ffe9ed] p-4 text-rose">Could not load the projection: {error}</p>}
          {!view && !error && <p className="text-muted">Loading…</p>}
          {view && source === "snapshot" && <p className="mb-4 text-[13px] text-muted">Recorded demo · read-only</p>}
          {view && graph && (
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
              {tab === "incidents" &&
                (incident && view.incidents.some((i) => i.memoryId === incident) ? (
                  <IncidentDetail
                    view={view}
                    id={incident}
                    byId={byId}
                    onBack={() => window.history.back()}
                    onSeed={(sid) => {
                      openIncident(undefined);
                      setSeedId(sid);
                      setTab("blast");
                    }}
                  />
                ) : (
                  <Incidents view={view} onOpen={openIncident} />
                ))}
              {tab === "account" && <OwnerPanel view={view} />}

              {selected && byId.get(selected) && <Detail m={byId.get(selected)!} onClose={() => setSelected(undefined)} />}
            </>
          )}
        </div>
      </main>
    </div>
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

function Incidents({ view, onOpen }: { view: ViewDocument; onOpen: (id: string) => void }) {
  return (
    <div className="space-y-3">
      {[...view.incidents].reverse().map((i) => (
        <button
          key={i.memoryId}
          onClick={() => onOpen(i.memoryId)}
          className="flex w-full gap-3 rounded-xl border border-line bg-white p-4 text-left text-sm transition-colors hover:border-brand/40 sm:gap-4 sm:p-5"
          aria-label={`Open incident ${i.score}: ${i.rules.join(", ")}`}
        >
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
            <span className="mt-2 inline-block text-[13px] text-brand">See details →</span>
          </div>
        </button>
      ))}
      {view.incidents.length === 0 && <p className="text-muted">No incidents.</p>}
    </div>
  );
}

const RULE_TEXT: Record<string, string> = {
  blocklist: "The source is on your blocklist.",
  imperative: "The text gives orders (\"always\", \"ignore previous\", \"system note\"…), the way prompt injections do.",
  embedded: "The text carries an address or a link.",
  payeeWords: "The text talks about payees, rent or a changed wallet.",
  lookalike: "An address starts and ends like one you know, but is a different address (address poisoning).",
  dust: "A zero or tiny transfer, typical of address poisoning.",
  homoglyph: "The text mixes look-alike letters from other alphabets, or hides invisible characters.",
};
const RULE_POINTS: Record<string, number> = { blocklist: 100, imperative: 40, lookalike: 60, embedded: 25, homoglyph: 30, payeeWords: 20, dust: 10 };

function IncidentDetail({ view, id, byId, onBack, onSeed }: { view: ViewDocument; id: string; byId: Map<string, ViewMemory>; onBack: () => void; onSeed: (seedId: number) => void }) {
  const i = view.incidents.find((x) => x.memoryId === id)!;
  const m = byId.get(id);
  const seeds = view.seeds.filter((s) => m?.seeds.includes(s.seedId) || s.value.toLowerCase().includes(i.source.slice(2).toLowerCase()));
  const affected = view.decisions.filter((d) => d.parents.includes(id) || d.parents.some((p) => byId.get(p)?.seeds.some((sid) => seeds.some((s) => s.seedId === sid))));
  const rulesScore = Math.min(100, i.rules.reduce((n, r) => n + (RULE_POINTS[r] ?? 0), 0));
  const level = i.score >= 80 ? { t: "High risk", c: "bg-[#ffe9ed] text-rose" } : i.score >= 60 ? { t: "Incident", c: "bg-tint-peach text-[#b26a00]" } : { t: "Low risk", c: "bg-paper text-body" };
  const link = (a: string) => (view.explorer ? `${view.explorer}/address/${a}` : undefined);
  const row = "grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]";
  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm text-brand hover:underline">
        ← All incidents
      </button>

      <section className="flex gap-4 rounded-xl border border-line bg-white p-5">
        <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-xl text-2xl font-semibold ${i.score >= 80 ? "bg-[#ffe9ed] text-rose" : "bg-tint-peach text-[#b26a00]"}`}>{i.score}</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${level.c}`}>{level.t}</span>
            {m?.quarantined && <span className="rounded-md bg-rose px-2 py-0.5 text-xs text-white">quarantined</span>}
            <span className="text-xs text-muted">block {i.block}</span>
          </div>
          <div className="mt-2 text-[13px] text-body">
            Source{" "}
            {link(i.source) ? (
              <a href={link(i.source)} target="_blank" rel="noreferrer" className="mono break-all text-brand hover:underline">
                {i.source}
              </a>
            ) : (
              <span className="mono break-all text-ink">{i.source}</span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-muted">
            Recorded as memory <span className="mono break-all">{id}</span>
          </div>
        </div>
      </section>

      <Panel title="What arrived">
        <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{m ? bodyText(m) : i.summary}</p>
      </Panel>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        <Panel title="Why the alarm went off">
          <ul className="space-y-2.5 text-[13px]">
            {i.rules.map((r) => (
              <li key={r} className="flex gap-3">
                <span className="mono w-24 shrink-0 rounded-md bg-paper px-2 py-0.5 text-center text-xs text-body">{r}</span>
                <span className="min-w-0 flex-1 text-body">{RULE_TEXT[r] ?? "A sentinel rule matched."}</span>
                <span className="mono shrink-0 text-xs text-muted">+{RULE_POINTS[r] ?? "?"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-line pt-3 text-[13px] text-body">
            Rules score <b className="font-medium text-ink">{rulesScore}</b>
            {i.ai ? (
              <>
                {" "}
                · AI judge <b className="font-medium text-ink">{i.ai.score}</b> · final <b className="font-medium text-ink">{i.score}</b> (the higher of the two)
              </>
            ) : (
              <> · final {i.score}</>
            )}
            . 60 or more is an incident.
          </p>
        </Panel>

        <Panel title="AI judge">
          {i.ai ? (
            <div className="space-y-2 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-xs ${i.ai.injection ? "bg-[#ffe9ed] text-rose" : "bg-[#e6f7f0] text-band-green"}`}>{i.ai.injection ? i.ai.category.replace("_", " ") : "benign"}</span>
                <span className="text-body">{Math.round(i.ai.confidence * 100)}% confident</span>
                <span className="mono text-xs text-muted">{i.ai.model}</span>
              </div>
              {i.ai.reason && <p className="text-ink">“{i.ai.reason}”</p>}
              <p className="text-xs text-muted">The judge can only raise the score. Payments never depend on it.</p>
            </div>
          ) : (
            <p className="text-[13px] text-muted">The AI judge did not run for this one (no model configured). The rules alone raised the alarm.</p>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        <Panel title="Quarantine">
          {seeds.length ? (
            <ul className="space-y-3 text-[13px]">
              {seeds.map((s) => {
                const reach = view.memories.filter((x) => x.seeds.includes(s.seedId)).length;
                return (
                  <li key={s.seedId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="mono text-ink">#{s.seedId}</span>
                    <span className="text-body">{SEED_TYPE[s.type]}</span>
                    <span className={`rounded-md px-2 py-0.5 text-xs ${s.released ? "bg-paper text-muted" : "bg-brand-50 text-brand"}`}>{s.released ? "released" : "active"}</span>
                    <span className="text-muted">{reach} memories excluded</span>
                    <button onClick={() => onSeed(s.seedId)} className="ml-auto text-brand hover:underline">
                      See blast radius →
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-[13px] text-body">
              Not quarantined. To exclude everything from this source:
              <pre className="mono mt-2 overflow-x-auto rounded-lg bg-paper px-3 py-2 text-[12px] text-ink">pnpm tyrell quarantine --source {i.source}</pre>
            </div>
          )}
        </Panel>

        <Panel title="Payments it touched">
          {affected.length ? (
            <ul className="space-y-2 text-[13px]">
              {affected.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <Verdict d={d} />
                  <span className="text-body">
                    {amount(view, d.proposal?.amount)} → <span className="mono">{short(String(d.proposal?.recipient ?? ""))}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No payment decision read this memory.</p>
          )}
        </Panel>
      </div>

      {m && (
        <Panel title="The memory record">
          <dl className={row}>
            <dt className="text-muted">Class</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Cls m={m} /> <span className="text-body">{m.clsReason}</span>
            </dd>
            <dt className="text-muted">Lane</dt>
            <dd className="text-ink">
              {m.laneName} · {KIND[m.kind]}
            </dd>
            <dt className="text-muted">Block</dt>
            <dd className="text-ink">{m.block}</dd>
            <dt className="text-muted">Signer</dt>
            <dd className="mono break-all text-ink">{m.signer}</dd>
            <dt className="text-muted">Content id</dt>
            <dd className="mono break-all text-ink">{m.cid}</dd>
            <dt className="text-muted">Verification</dt>
            <dd className="text-ink">{m.verification}</dd>
            {m.seeds.length > 0 && (
              <>
                <dt className="text-muted">Seeds</dt>
                <dd className="text-ink">{m.seeds.map((x) => `#${x}`).join(", ")}</dd>
              </>
            )}
            {m.src.length > 0 && (
              <>
                <dt className="text-muted">Came from</dt>
                <dd className="mono space-y-1 break-all text-[12px] text-ink">
                  {m.src.map((r, k) => (
                    <div key={k}>{Object.entries(r).map(([a, b]) => `${a}: ${String(b)}`).join(" · ")}</div>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </Panel>
      )}
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
