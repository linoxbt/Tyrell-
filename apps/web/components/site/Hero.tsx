"use client";

import Link from "next/link";
import { amount, bodyText, CLS_STYLE, short, type ViewDocument } from "@/lib/view";
import { Mark } from "../Logo";

export function Hero({ view }: { view?: ViewDocument }) {
  return (
    <section className="grid-bg relative overflow-hidden border-b border-line">
      <div className="mx-auto max-w-[1200px] px-6 pt-24 text-center md:pt-32">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-sm text-stone-700 shadow-sm">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Built on QIE · {view ? `${view.network} chain ${view.chainId}, block ${view.head}` : "mainnet chain 1990"}
        </span>
        <h1 className="mx-auto mt-6 max-w-[900px] text-[44px] font-medium leading-[1.02] tracking-[-0.045em] md:text-[80px]">
          Know where every memory your agent trusts came from.
        </h1>
        <p className="mx-auto mt-6 max-w-[640px] text-lg leading-relaxed text-stone-600">
          Tyrell signs, anchors and traces everything your AI agent reads, on QIE. When a source turns out to be poisoned, the vault refuses the payment, you
          see the blast radius, and one quarantine restores a clean state from the chain alone.
        </p>
        <div className="mt-9 flex justify-center gap-3">
          <Link href="/console" className="rounded-lg bg-brand px-6 py-3.5 font-medium text-white shadow-sm hover:bg-brand-600">
            Open the console
          </Link>
          <a href="#how" className="rounded-lg border border-brand/40 bg-white px-6 py-3.5 font-medium text-brand hover:border-brand">
            See how it works
          </a>
        </div>
        <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs uppercase tracking-wide text-stone-500">
          <li>✓ EIP-712 lane keys</li>
          <li>✓ Payments enforced on-chain</li>
          <li>✓ Rebuild from QIE + IPFS</li>
        </ul>
      </div>
      <div className="relative mx-auto mt-16 max-w-[1200px] px-6">
        <div className="halftone pointer-events-none absolute -left-6 bottom-0 h-40 w-40 opacity-60" />
        <div className="halftone pointer-events-none absolute -right-6 bottom-0 h-40 w-40 opacity-60" />
        <ConsoleWindow view={view} />
      </div>
    </section>
  );
}

function ConsoleWindow({ view }: { view?: ViewDocument }) {
  const blocked = view?.decisions.filter((d) => d.verdict?.decision === "BLOCK").at(-1);
  const seed = view?.seeds.filter((s) => !s.released).at(-1);
  const counts = (view?.memories ?? []).reduce<Record<string, number>>((a, m) => ((a[m.cls] = (a[m.cls] ?? 0) + 1), a), {});
  const quarantined = view?.memories.filter((m) => m.quarantined).length ?? 0;
  return (
    <div className="relative">
      {blocked && (
        <div className="float-in absolute -top-8 right-4 z-10 flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-left shadow-lg md:right-[-12px]">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-rose-100 text-rose-600">⛨</span>
          <span>
            <span className="block text-sm font-medium">Payment blocked</span>
            <span className="mono block text-[11px] text-stone-500">
              {blocked.verdict?.code} → {short(String(blocked.proposal?.recipient ?? ""), 4)}
            </span>
          </span>
        </div>
      )}
      {seed && (
        <div className="float-in absolute -left-2 top-28 z-10 hidden items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-left shadow-lg md:flex" style={{ animationDelay: "0.25s" }}>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-emerald-700">✓</span>
          <span>
            <span className="block text-sm font-medium">Source quarantined</span>
            <span className="mono block text-[11px] text-stone-500">seed #{seed.seedId} · on-chain</span>
          </span>
        </div>
      )}
      <div className="overflow-hidden rounded-t-2xl border border-b-0 border-line bg-white shadow-[0_-20px_60px_-30px_rgba(108,92,231,0.35)]">
        <div className="flex items-center gap-2 border-b border-line bg-stone-50 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="mono mx-auto flex items-center gap-2 rounded-full border border-line bg-white px-4 py-1 text-xs text-stone-600">
            <Mark size={14} /> tyrell / steward / {view?.network ?? "mainnet"}
          </span>
        </div>
        <div className="grid grid-cols-[56px_1fr] text-left">
          <div className="flex flex-col items-center gap-4 border-r border-line py-5">
            <Mark size={24} />
            {["◎", "⌘", "◇", "≡"].map((i, n) => (
              <span key={i} className={`grid h-8 w-8 place-items-center rounded-lg text-sm ${n === 0 ? "bg-brand-50 text-brand" : "text-stone-400"}`}>
                {i}
              </span>
            ))}
          </div>
          <div className="p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold">steward</span>
              <span className="text-stone-400">/ decisions</span>
              <span className="ml-auto flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-stone-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {view?.network ?? "—"}
              </span>
              <span className="mono rounded-full border border-line px-3 py-1 text-xs text-stone-600">digest {view ? short(view.digest, 4) : "—"}</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
              {[
                ["memories", view?.memories.length ?? 0, ""],
                ["trusted", counts.trusted ?? 0, "text-emerald-700"],
                ["derived", counts.derived ?? 0, "text-sky-700"],
                ["untrusted", counts.untrusted ?? 0, "text-amber-700"],
                ["quarantined", quarantined, "text-rose-600"],
              ].map(([l, v, c]) => (
                <div key={String(l)} className="rounded-xl border border-line px-4 py-3">
                  <div className={`text-2xl font-semibold tracking-tight ${c}`}>{v}</div>
                  <div className="text-xs text-stone-500">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-5 divide-y divide-line rounded-xl border border-line">
              {(view?.decisions ?? []).slice(-3).reverse().map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${d.verdict?.decision === "ALLOW" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                    {d.verdict?.decision} {d.verdict?.code}
                  </span>
                  <span className="text-stone-700">
                    {view ? amount(view, d.proposal?.amount) : ""} → <span className="mono">{short(String(d.proposal?.recipient ?? ""), 4)}</span>
                  </span>
                  <span className="ml-auto text-xs text-stone-400">read {d.parents.length} memories</span>
                </div>
              ))}
              {(view?.memories ?? []).filter((m) => m.kind !== 5).slice(-2).reverse().map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className={`rounded-md px-2 py-0.5 text-xs ${CLS_STYLE[m.cls]}`}>{m.cls}</span>
                  {m.quarantined && <span className="rounded-md bg-rose-600 px-2 py-0.5 text-xs text-white">quarantined</span>}
                  <span className="truncate text-stone-600">{bodyText(m)}</span>
                </div>
              ))}
              {!view && <div className="px-4 py-6 text-sm text-stone-400">Loading the projection…</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
