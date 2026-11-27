"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV, tabOf } from "@/lib/docs-nav";
import { Wordmark } from "../Logo";
import { REPO } from "../argus/ui";
import { Search, SearchButton } from "./Search";

/** Docs chrome, after docs.arc.io: a top bar with search, product tabs, and a grouped sidebar. */
export function DocsShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const slug = path.replace(/^\/docs\/?/, "");
  const tab = tabOf(slug) ?? (slug ? undefined : NAV[0]);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState(false);

  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
      }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (
    <nav className="space-y-7 text-[14px]" aria-label="Docs">
      {(tab ?? NAV[0]!).groups.map((g) => (
        <div key={g.title}>
          <div className="mb-2 px-3 text-[12px] font-medium uppercase tracking-wider text-muted">{g.title}</div>
          <ul className="space-y-0.5">
            {g.pages.map((p) => {
              const active = slug === p.slug;
              return (
                <li key={p.slug}>
                  <Link
                    href={`/docs/${p.slug}`}
                    className={`block rounded-lg px-3 py-1.5 transition-colors ${active ? "bg-brand-50 font-medium text-brand" : "text-body hover:bg-paper hover:text-ink"}`}
                    aria-current={active ? "page" : undefined}
                  >
                    {p.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
          <button onClick={() => setDrawer(true)} className="-ml-1 grid h-9 w-9 place-items-center rounded-lg text-ink hover:bg-paper lg:hidden" aria-label="Open navigation">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <Link href="/" aria-label="Tyrell home" className="shrink-0">
            <Wordmark size={24} />
          </Link>
          <Link href="/docs" className="rounded-md bg-paper px-2 py-0.5 text-[13px] text-body hover:text-ink">
            Docs
          </Link>
          <div className="ml-auto flex items-center gap-2 sm:ml-6 sm:flex-1">
            <SearchButton onClick={() => setSearch(true)} />
          </div>
          <nav className="hidden items-center gap-5 text-[14px] text-nav md:flex">
            <Link href="/playground" className="hover:text-ink">
              Playground
            </Link>
            <Link href="/console" className="hover:text-ink">
              Console
            </Link>
            <a href={REPO} className="hover:text-ink">
              GitHub
            </a>
          </nav>
        </div>
        <div className="mx-auto max-w-[1400px] overflow-x-auto px-4 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
          <div className="flex gap-6 text-[14px]">
            {NAV.map((t) => {
              const active = tab?.id === t.id;
              return (
                <Link key={t.id} href={`/docs/${t.groups[0]!.pages[0]!.slug}`} className={`-mb-px shrink-0 whitespace-nowrap border-b-2 py-2.5 transition-colors ${active ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                  {t.label}
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px]">
        <aside className="sticky top-[101px] hidden h-[calc(100vh-101px)] w-[264px] shrink-0 overflow-y-auto border-r border-line px-3 py-8 lg:block">{sidebar}</aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>

      {/* phone and tablet navigation drawer */}
      <div className={`fixed inset-0 z-50 transition-[visibility] duration-300 lg:hidden ${drawer ? "visible" : "pointer-events-none invisible"}`}>
        <div onClick={() => setDrawer(false)} className={`absolute inset-0 bg-ink/30 transition-opacity duration-300 ${drawer ? "opacity-100" : "opacity-0"}`} />
        <div className={`absolute inset-y-0 left-0 w-[86%] max-w-[320px] overflow-y-auto bg-white px-3 pb-10 pt-4 shadow-xl transition-transform duration-300 ${drawer ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="mb-5 flex items-center justify-between px-3">
            <Wordmark size={22} />
            <button onClick={() => setDrawer(false)} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-paper" aria-label="Close navigation">
              ✕
            </button>
          </div>
          <div className="mb-6 space-y-0.5 border-b border-line pb-5">
            {NAV.map((t) => (
              <Link key={t.id} href={`/docs/${t.groups[0]!.pages[0]!.slug}`} className={`block rounded-lg px-3 py-1.5 text-[14px] ${tab?.id === t.id ? "font-medium text-ink" : "text-body"}`}>
                {t.label}
              </Link>
            ))}
          </div>
          {sidebar}
        </div>
      </div>

      <Search open={search} onClose={() => setSearch(false)} />
    </div>
  );
}
