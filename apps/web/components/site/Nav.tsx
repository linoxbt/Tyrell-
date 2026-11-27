import Link from "next/link";
import { Wordmark } from "../Logo";

export const REPO = "https://github.com/linoxbt/Tyrell-";

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-[1200px] items-center px-6">
        <Link href="/" aria-label="Tyrell home">
          <Wordmark />
        </Link>
        <nav className="mx-auto hidden gap-8 text-[15px] text-stone-600 md:flex">
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#platform" className="hover:text-ink">Platform</a>
          <a href="#attacks" className="hover:text-ink">Attack set</a>
          <a href="#guarantees" className="hover:text-ink">Guarantees</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
        </nav>
        <div className="ml-auto flex items-center gap-5 md:ml-0">
          <a href={REPO} className="hidden text-[15px] text-stone-600 hover:text-ink sm:block">GitHub</a>
          <Link href="/console" className="rounded-lg bg-brand px-4 py-2.5 text-[15px] font-medium text-white shadow-sm hover:bg-brand-600">
            Open console
          </Link>
        </div>
      </div>
    </header>
  );
}
