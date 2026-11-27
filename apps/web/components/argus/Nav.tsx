"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "../Logo";
import { REPO } from "./ui";

const LINKS: Array<[string, string]> = [
  ["Problem", "#problem"],
  ["Platform", "#platform"],
  ["Attack set", "#attacks"],
  ["Guarantees", "#guarantees"],
  ["FAQ", "#faq"],
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // close the sheet on Escape and when the viewport grows past the breakpoint
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const mq = window.matchMedia("(min-width: 768px)");
    const onMq = () => mq.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 border-b bg-white/85 backdrop-blur-md transition-[border-color,box-shadow] duration-300 ${
        scrolled || open ? "border-line shadow-[0_1px_12px_rgba(15,18,32,0.05)]" : "border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center px-4 sm:px-6 md:h-[74px] xl:px-0">
        <Link href="/" aria-label="Tyrell home" onClick={() => setOpen(false)}>
          <Wordmark />
        </Link>
        <nav className="mx-auto hidden gap-7 text-base text-nav md:flex">
          {LINKS.map(([l, h]) => (
            <a key={h} href={h} className="transition-colors hover:text-ink">
              {l}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 sm:gap-6 md:ml-0">
          <a href={REPO} className="hidden text-base text-nav transition-colors hover:text-ink lg:block">
            GitHub
          </a>
          <Link
            href="/console"
            className="whitespace-nowrap rounded-lg bg-brand px-4 py-2.5 text-[15px] leading-none text-snow transition-[background-color,transform] duration-200 hover:bg-brand-deep active:scale-[0.98] sm:px-[19px] sm:py-3 sm:text-base"
          >
            Open console
          </Link>
          <button
            className="-mr-2 grid h-10 w-10 place-items-center rounded-lg text-ink transition-colors hover:bg-paper md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="relative block h-3.5 w-5">
              <span className={`absolute left-0 top-0 h-[1.5px] w-5 rounded bg-current transition-transform duration-300 ${open ? "translate-y-[6px] rotate-45" : ""}`} />
              <span className={`absolute left-0 top-[6px] h-[1.5px] w-5 rounded bg-current transition-opacity duration-200 ${open ? "opacity-0" : ""}`} />
              <span className={`absolute left-0 top-3 h-[1.5px] w-5 rounded bg-current transition-transform duration-300 ${open ? "-translate-y-[6px] -rotate-45" : ""}`} />
            </span>
          </button>
        </div>
      </div>

      {/* the mobile sheet overlays the page (so closing it never shifts the scroll target) and animates its height */}
      <div id="mobile-menu" className={`absolute inset-x-0 top-full grid bg-white transition-[grid-template-rows,box-shadow] duration-300 ease-out md:hidden ${open ? "grid-rows-[1fr] border-b border-line shadow-[0_16px_30px_rgba(15,18,32,0.08)]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <nav className="flex flex-col px-4 pb-5 pt-1 sm:px-6">
            {[...LINKS, ["GitHub", REPO] as [string, string]].map(([l, h], i) => (
              <a
                key={h}
                href={h}
                onClick={() => setOpen(false)}
                className={`border-b border-line py-3.5 text-[17px] text-ink transition-[opacity,transform] duration-300 last:border-0 ${open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"}`}
                style={{ transitionDelay: open ? `${60 + i * 30}ms` : "0ms" }}
                tabIndex={open ? 0 : -1}
              >
                {l}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
