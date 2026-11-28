"use client";

import Link from "next/link";
import { useState } from "react";
import { Pill } from "../argus/ui";
import { Demo } from "./Demo";
import { Proof } from "./Proof";
import { Recorded } from "./Recorded";
import { RecordedRun } from "./RecordedRun";
import { TryIt } from "./TryIt";

/*
 * The playground, as one page anyone can follow: a short setup, a three-step attack run on two AI agents
 * (an ordinary wallet and Tyrell), the outcome in plain words, then the proof and the developer extras.
 */
export function Playground() {
  return (
    <>
      <section className="relative overflow-hidden bg-white">
        <div className="grid-lines absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-white" />
        <div className="relative mx-auto max-w-[860px] px-4 pb-12 pt-14 text-center sm:px-6 md:pt-20">
          <Pill>Playground · no wallet, no sign-up</Pill>
          <h1 className="h-section mt-5 text-ink">Can a hacker trick an AI into sending them your money?</h1>
          <p className="t-lead mx-auto mt-4 max-w-[640px] text-body">
            Run the same attack on two AI agents that pay your rent. One uses an ordinary wallet. The other is protected by Tyrell. It takes a minute, and there is nothing to install.
          </p>
          <a href="#demo" className="mt-7 inline-flex rounded-xl bg-brand px-6 py-3 text-[16px] font-medium text-white transition-colors hover:bg-brand-deep">
            Start the demo ↓
          </a>
        </div>
      </section>

      <div className="bg-paper">
        <div id="demo" className="mx-auto max-w-[860px] scroll-mt-20 px-4 py-12 sm:px-6 md:py-16">
          <Demo />
        </div>
      </div>

      <div className="bg-white">
        <div className="mx-auto max-w-[860px] px-4 py-12 sm:px-6 md:py-16">
          <Proof />
        </div>
      </div>

      <div className="bg-paper">
        <div className="mx-auto max-w-[1000px] px-4 py-12 sm:px-6 md:py-16">
          <h2 className="text-[22px] font-medium tracking-[-0.01em] text-ink sm:text-[26px]">For developers</h2>
          <p className="mt-2 max-w-[640px] text-[15px] leading-relaxed text-body">
            The technical details, for anyone who wants to dig in. Everything is open source: see the{" "}
            <Link href="/docs/guides/playground" className="text-brand hover:underline">
              playground docs
            </Link>{" "}
            and the{" "}
            <Link href="/console" className="text-brand hover:underline">
              console
            </Link>
            .
          </p>
          <div className="mt-5 space-y-3">
            <Extra title="Explore a full recorded run" sub="Every memory, the lineage graph, decisions and incidents from a recorded end-to-end run, as the console shows a real account">
              <RecordedRun />
            </Extra>
            <Extra title="Every test in the repository" sub="TypeScript and Foundry test suites, and the 10-attack set, as last recorded">
              <Recorded />
            </Extra>
            <Extra title="Poke at the safety rules yourself" sub="The scam detector, the payment rules, QIE ID lookups and agent-to-agent checks">
              <TryIt />
            </Extra>
          </div>
        </div>
      </div>
    </>
  );
}

function Extra({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  // contents mount on first open: the lineage graph needs a visible box to lay itself out
  const [seen, setSeen] = useState(false);
  return (
    <details className="group rounded-2xl border border-line bg-white" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setSeen(true)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-ink">{title}</span>
          <span className="block text-[13px] text-muted">{sub}</span>
        </span>
        <span className="text-muted transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-line p-4 sm:p-5">{seen ? children : null}</div>
    </details>
  );
}
