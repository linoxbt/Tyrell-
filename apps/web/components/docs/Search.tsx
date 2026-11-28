"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

interface Entry {
  slug: string;
  title: string;
  description: string;
  tab: string;
  headings: Array<{ text: string; id: string }>;
  text: string;
}
interface Hit {
  href: string;
  title: string;
  section?: string;
  snippet: string;
  score: number;
}

let indexPromise: Promise<Entry[]> | undefined;
/** Loads the index once; a failed load is forgotten, so the next search tries again. */
const loadIndex = () =>
  (indexPromise ??= fetch("/docs/search.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<Entry[]>;
    })
    .catch((e: unknown) => {
      indexPromise = undefined;
      throw e;
    }));

export function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center gap-2 rounded-lg border border-line bg-paper text-[14px] text-muted transition-colors hover:border-brand/40 hover:text-ink sm:w-full sm:max-w-[420px] sm:justify-start sm:px-3"
      aria-label="Search the docs"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <span className="hidden sm:inline">Search docs…</span>
      <kbd className="mono ml-auto hidden rounded border border-line bg-white px-1.5 text-[11px] sm:inline">⌘K</kbd>
    </button>
  );
}

function search(index: Entry[], q: string): Hit[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: Hit[] = [];
  for (const e of index) {
    const title = e.title.toLowerCase();
    const desc = e.description.toLowerCase();
    const text = e.text.toLowerCase();
    let page = 0;
    for (const t of terms) {
      if (title.includes(t)) page += 10;
      if (desc.includes(t)) page += 4;
      if (text.includes(t)) page += 1;
      else if (!title.includes(t) && !desc.includes(t)) page = -1000;
    }
    if (page > 0) {
      const i = text.indexOf(terms[0]!);
      const snippet = i >= 0 ? `${i > 40 ? "…" : ""}${e.text.slice(Math.max(0, i - 40), i + 110)}…` : e.description;
      hits.push({ href: `/docs/${e.slug}`, title: e.title, snippet, score: page });
    }
    for (const h of e.headings) {
      const ht = h.text.toLowerCase();
      if (terms.every((t) => ht.includes(t) || title.includes(t))) hits.push({ href: `/docs/${e.slug}#${h.id}`, title: e.title, section: h.text, snippet: h.text, score: 8 + terms.filter((t) => ht.includes(t)).length * 6 });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12);
}

export function Search({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<Entry[]>([]);
  const [sel, setSel] = useState(0);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    void loadIndex().then(setIndex, () => setFailed(true));
    setTimeout(() => input.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const hits = useMemo(() => search(index, q), [index, q]);
  useEffect(() => setSel(0), [q]);
  const go = (h: Hit) => {
    onClose();
    setQ("");
    router.push(h.href);
  };

  return (
    <div className={`fixed inset-0 z-[70] transition-[visibility] duration-200 ${open ? "visible" : "pointer-events-none invisible"}`} role="dialog" aria-modal="true" aria-label="Search the docs">
      <div onClick={onClose} className={`absolute inset-0 bg-ink/30 backdrop-blur-[2px] transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} />
      <div className={`absolute left-1/2 top-[8vh] w-[calc(100%-24px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_80px_rgba(15,18,32,0.25)] transition-[opacity,transform] duration-200 ${open ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"}`}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, hits.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              if (e.key === "Enter" && hits[sel]) go(hits[sel]!);
            }}
            placeholder="Search: payForAgent, quarantine, QIE ID, R4…"
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
          />
          <kbd className="mono hidden rounded border border-line px-1.5 text-[11px] text-muted sm:inline">esc</kbd>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto p-2">
          {failed && <li className="px-3 py-6 text-center text-sm text-rose">Search could not load. Close and open it again to retry.</li>}
          {!failed && q && hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No results for “{q}”.</li>}
          {!q && <li className="px-3 py-6 text-center text-sm text-muted">Search every page of the Tyrell docs.</li>}
          {hits.map((h, i) => (
            <li key={`${h.href}-${i}`}>
              <button onMouseEnter={() => setSel(i)} onClick={() => go(h)} className={`w-full rounded-xl px-3 py-2.5 text-left ${i === sel ? "bg-brand-50" : ""}`}>
                <div className="text-[14px] text-ink">
                  {h.section ? (
                    <>
                      <span className="text-muted">{h.title} › </span>
                      {h.section}
                    </>
                  ) : (
                    h.title
                  )}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[12px] text-body">{h.snippet}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
