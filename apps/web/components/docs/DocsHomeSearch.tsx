"use client";

/** The big search field on the docs home: opens the ⌘K search. */
export function DocsHomeSearch() {
  return (
    <button
      onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
      className="flex h-12 w-full items-center gap-3 rounded-xl border border-line bg-white px-4 text-left text-[15px] text-muted shadow-[0_1px_2px_rgba(15,18,32,0.04)] transition-colors hover:border-brand/40"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      Search the docs…
      <kbd className="mono ml-auto rounded border border-line px-1.5 text-[11px]">⌘K</kbd>
    </button>
  );
}
