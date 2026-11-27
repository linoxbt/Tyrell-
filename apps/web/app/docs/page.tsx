import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/argus/ui";
import { DocsHomeSearch } from "@/components/docs/DocsHomeSearch";

export const metadata: Metadata = { title: "Tyrell Docs", description: "Build AI agents whose memories have provenance and whose payments the chain enforces, on QIE." };

const START: Array<[string, string, string, Parameters<typeof Icon>[0]["name"]]> = [
  ["Quickstart", "Run the whole system and its tests on a local chain in minutes.", "/docs/get-started/quickstart", "pulse"],
  ["How it works", "Lanes, signed envelopes, lineage, trust classes and the payment policy.", "/docs/get-started/how-it-works", "graph"],
  ["Deploy on QIE", "Keys, contracts and owner registration on QIE Testnet, then Mainnet.", "/docs/guides/deploy-on-qie", "check"],
  ["Playground", "The contracts running live in your browser. No wallet, no login.", "/docs/guides/playground", "flag"],
];
const TOPICS: Array<[string, string, string]> = [
  ["Payees", "Register who your agent may pay, through QIE ID, with your key.", "/docs/guides/payees"],
  ["Quarantine and blast radius", "Trace a poisoned source to everything it reached; exclude it with one seed.", "/docs/guides/quarantine-and-blast-radius"],
  ["AI sentinel", "Rules plus an AI judge that can raise alarms and never clear them.", "/docs/guides/ai-sentinel"],
  ["Rebuild and verify", "Throw the database away; rebuild from QIE and IPFS; prove the digest.", "/docs/guides/rebuild-and-verify"],
  ["Attack set", "Ten attacks against a fully compromised model. Nothing paid.", "/docs/guides/attack-set"],
  ["Web console and wallet", "The console, Reown wallet login and the owner's controls.", "/docs/guides/web-console-and-wallet"],
];
const AGENTS: Array<[string, string, string]> = [
  ["QIE ID binding", "Every agent is bound to its human, every human to a QIE ID, checked live on-chain.", "/docs/agents/qie-id-binding"],
  ["Agents, permissions and quota", "N agents, 1 human, 1 shared quota; delegated payees; freeze and revoke.", "/docs/agents/agents-and-limits"],
  ["Bonds, reports and penalties", "Accountable reports, a contest window, an arbiter, slashing and bans.", "/docs/agents/bonds-and-reports"],
  ["Agent-to-agent", "Signed messages verified on-chain, escrowed deals that build reputation.", "/docs/agents/agent-to-agent"],
];
const REF: Array<[string, string]> = [
  ["CLI", "/docs/reference/cli"],
  ["Core contracts", "/docs/reference/contracts-core"],
  ["Agents network contracts", "/docs/reference/contracts-agents"],
  ["Policy rules", "/docs/reference/policy-rules"],
  ["Errors and codes", "/docs/reference/errors"],
  ["Configuration", "/docs/reference/configuration"],
  ["Networks", "/docs/reference/networks"],
  ["Envelope format", "/docs/reference/envelope-format"],
];

export default function DocsHome() {
  return (
    <div className="px-4 pb-24 pt-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[980px]">
        <div className="relative overflow-hidden rounded-[24px] border border-line bg-paper px-6 py-10 sm:px-10 sm:py-14">
          <div className="grid-lines absolute inset-0 opacity-70" />
          <div className="relative">
            <div className="text-[13px] font-medium text-brand">Tyrell developer documentation</div>
            <h1 className="mt-3 max-w-[640px] text-[32px] font-medium leading-tight tracking-[-0.03em] text-ink sm:text-[44px]">
              Agents whose memories you can trace and whose payments the chain enforces
            </h1>
            <p className="mt-4 max-w-[600px] text-[17px] leading-relaxed text-body">
              Everything to run Tyrell on QIE: start fast on a local chain, deploy to testnet and mainnet, and put many agents under one accountable human.
            </p>
            <div className="mt-7 max-w-[520px]">
              <DocsHomeSearch />
            </div>
          </div>
        </div>

        <h2 className="mt-14 text-[22px] font-medium tracking-[-0.01em] text-ink">Start here</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {START.map(([t, d, href, icon]) => (
            <Link key={href} href={href} className="group rounded-2xl border border-line bg-white p-5 transition-[border-color,box-shadow] hover:border-brand/40 hover:shadow-[0_6px_24px_rgba(15,18,32,0.06)]">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand">
                <Icon name={icon} />
              </span>
              <div className="mt-4 text-[17px] font-medium text-ink">{t}</div>
              <p className="mt-1 text-[14px] leading-relaxed text-body">{d}</p>
            </Link>
          ))}
        </div>

        <h2 className="mt-14 text-[22px] font-medium tracking-[-0.01em] text-ink">Guides</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOPICS.map(([t, d, href]) => (
            <Link key={href} href={href} className="rounded-2xl border border-line bg-white p-5 transition-colors hover:border-brand/40 hover:bg-paper/50">
              <div className="text-[16px] font-medium text-ink">{t}</div>
              <p className="mt-1 text-[14px] leading-relaxed text-body">{d}</p>
            </Link>
          ))}
        </div>

        <div className="mt-14 overflow-hidden rounded-[24px] bg-night p-6 text-snow sm:p-8">
          <div className="text-[13px] font-medium text-[#a78bfa]">Agents network</div>
          <h2 className="mt-2 text-[24px] font-medium tracking-[-0.01em]">N agents. 1 human. 1 shared quota. Bound to a QIE ID.</h2>
          <p className="mt-2 max-w-[640px] text-[15px] text-mist">Phase A puts many agents under one accountable human; phase B lets agents of different humans deal with each other, with bonds, reports and reputation.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {AGENTS.map(([t, d, href]) => (
              <Link key={href} href={href} className="rounded-2xl border border-white/10 bg-night-card p-4 transition-colors hover:border-[#a78bfa]/50">
                <div className="text-[15px] font-medium">{t}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-fog">{d}</p>
              </Link>
            ))}
          </div>
          <Link href="/docs/agents/overview" className="mt-5 inline-block text-[14px] text-[#a78bfa] hover:underline">
            Read the overview →
          </Link>
        </div>

        <h2 className="mt-14 text-[22px] font-medium tracking-[-0.01em] text-ink">Reference</h2>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {REF.map(([t, href]) => (
            <Link key={href} href={href} className="rounded-xl border border-line px-4 py-3 text-[14px] text-ink transition-colors hover:border-brand/40 hover:bg-paper">
              {t} →
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
