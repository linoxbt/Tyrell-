"use client";

import { useEffect, useState } from "react";
import { ProjectionBody, type ProjectionTab } from "@/components/console/Projection";
import type { ViewDocument } from "@/lib/view";

/*
 * A full recorded run, shown the way the console shows a real account: every process ran on a local test
 * chain, a poisoned token arrived, the payment was refused, the source was quarantined and the clean state
 * came back. This is sample data, so it lives here and never in the console.
 */
const TABS: Array<[ProjectionTab, string]> = [
  ["overview", "Overview"],
  ["graph", "Lineage"],
  ["blast", "Blast radius"],
  ["decisions", "Decisions"],
  ["timeline", "Timeline"],
  ["incidents", "Incidents"],
];

export function RecordedRun() {
  const [view, setView] = useState<ViewDocument>();
  const [tab, setTab] = useState<ProjectionTab>("overview");
  useEffect(() => {
    void fetch("/snapshot.json")
      .then((r) => r.json() as Promise<ViewDocument>)
      .then(setView)
      .catch(() => undefined);
  }, []);
  if (!view) return <p className="text-sm text-muted">Loading the recorded run…</p>;
  return (
    <div>
      <p className="mb-4 text-[14px] leading-relaxed text-body">
        A poisoned token arrives, the payment it asks for is refused, the source is quarantined and the clean state comes back: {view.memories.length} memories and {view.decisions.length} decisions, recorded from every Tyrell process
        running on a test chain.
      </p>
      <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
        {TABS.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${tab === t ? "border-brand bg-brand text-white" : "border-line bg-white text-body hover:border-brand/40"}`}>
            {l}
            {t === "incidents" ? ` ${view.incidents.length}` : ""}
          </button>
        ))}
      </div>
      <div className="rounded-2xl bg-[#f7f8fa] p-3 sm:p-4">
        <ProjectionBody view={view} tab={tab} />
      </div>
    </div>
  );
}
