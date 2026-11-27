import Link from "next/link";
import { Wordmark } from "../Logo";
import { REPO } from "./ui";

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-white">
      <div className="mx-auto flex h-[74px] max-w-[1200px] items-center px-6 xl:px-0">
        <Link href="/" aria-label="Tyrell home">
          <Wordmark />
        </Link>
        <nav className="mx-auto hidden gap-7 text-base text-nav md:flex">
          <a href="#problem" className="hover:text-ink">Problem</a>
          <a href="#platform" className="hover:text-ink">Platform</a>
          <a href="#attacks" className="hover:text-ink">Attack set</a>
          <a href="#guarantees" className="hover:text-ink">Guarantees</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
        </nav>
        <div className="ml-auto flex items-center gap-6 md:ml-0">
          <a href={REPO} className="hidden text-base text-nav hover:text-ink sm:block">GitHub</a>
          <Link href="/console" className="rounded-lg bg-brand px-[19px] py-3 text-base leading-none text-snow hover:bg-brand-deep">
            Open console
          </Link>
        </div>
      </div>
    </header>
  );
}
