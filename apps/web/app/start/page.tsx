"use client";

import Link from "next/link";
import { useState } from "react";
import { Nav } from "@/components/argus/Nav";
import { Footer } from "@/components/argus/Sections";
import { Check, Icon, Pill, REPO } from "@/components/argus/ui";
import { ConnectButton } from "@/components/wallet/Wallet";
import { useSample } from "@/lib/useView";
import { QIE_WALLET_RDNS, QIE_WALLET_URL, chainName, useWallet } from "@/lib/wallet";

type State = "done" | "todo" | "now";

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1400);
      }}
      className="ml-auto rounded-md px-2 py-0.5 text-[11px] text-mist transition-colors hover:bg-white/10 hover:text-white"
    >
      {ok ? "Copied ✓" : "Copy"}
    </button>
  );
}

/** A terminal snippet: header bar with the copy button, code scrolls sideways underneath. Comments are not copied. */
function Code({ children }: { children: string }) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl bg-night">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="mono ml-2 text-[10.5px] text-fog">terminal</span>
        <Copy text={children.replace(/^\s*#.*$/gm, "").replace(/\s+#.*$/gm, "").replace(/\n{2,}/g, "\n").trim()} />
      </div>
      <pre className="mono overflow-x-auto px-4 py-3 text-[12.5px] leading-[1.7] text-snow">{children}</pre>
    </div>
  );
}

function Step({ n, state, title, children, action }: { n: number; state: State; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className={`relative rounded-[20px] border bg-white p-5 transition-shadow sm:p-6 ${state === "now" ? "border-brand/50 shadow-[0_0_0_4px_rgba(124,92,255,0.08)]" : "border-line"}`}>
      <div className="flex items-start gap-4">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-medium ${state === "done" ? "bg-band-green text-white" : state === "now" ? "bg-brand text-white" : "bg-paper text-muted"}`}>
          {state === "done" ? <Check className="h-4 w-4" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="text-[18px] font-medium tracking-[-0.01em] text-ink sm:text-[19px]">{title}</h3>
            {action && <div className="ml-auto">{action}</div>}
          </div>
          <div className="mt-2 text-[15px] leading-[1.6] text-body">{children}</div>
        </div>
      </div>
    </li>
  );
}

export default function Start() {
  const { view } = useSample();
  const w = useWallet();
  const hasWallet = w.wallets.length > 0;
  const hasQie = w.wallets.some((x) => x.rdns === QIE_WALLET_RDNS);
  const onQie = w.chainId === 1990 || w.chainId === 1983;
  const net = w.chainId === 1983 ? "testnet" : "mainnet";

  const s1: State = hasWallet || w.account ? "done" : "now";
  const s2: State = w.session ? "done" : s1 === "done" ? "now" : "todo";
  const s3: State = w.account && onQie ? "done" : s2 === "done" ? "now" : "todo";
  const browserDone = s1 === "done" && s2 === "done" && s3 === "done";

  return (
    <>
      <Nav />
      <main>
        <section className="relative overflow-hidden bg-white">
          <div className="grid-lines absolute inset-0" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-white" />
          <div className="relative mx-auto max-w-[860px] px-4 pb-12 pt-14 text-center sm:px-6 md:pb-16 md:pt-20">
            <Pill>Get started</Pill>
            <h1 className="h-section mt-5 text-ink">Put your agent under Tyrell</h1>
            <p className="t-lead mx-auto mt-4 max-w-[620px] text-body">
              Your wallet is the owner. Your agent proposes. Tyrell checks every memory and payment, then the chain decides. Setup takes about ten minutes.
            </p>
          </div>
        </section>

        {/* who does what */}
        <section className="bg-white">
          <div className="mx-auto grid max-w-[1000px] gap-3 px-4 pb-12 sm:grid-cols-3 sm:px-6">
            {[
              ["You", "QIE Wallet", "Owns the account. Registers and revokes your agent's keys, releases quarantines.", "shield"],
              ["Your agent", "Steward", "Reads, remembers and proposes payments. It never holds a key that can pay.", "pulse"],
              ["Tyrell", "on your machine", "Signs, anchors and traces every memory. Pays only registered payees within caps.", "check"],
            ].map(([who, what, body, icon]) => (
              <div key={who} className="rounded-[18px] border border-line bg-paper p-5">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-brand">
                    <Icon name={icon as "shield"} />
                  </span>
                  <div>
                    <div className="text-[15px] font-medium text-ink">{who}</div>
                    <div className="text-xs text-muted">{what}</div>
                  </div>
                </div>
                <p className="mt-3 text-[14px] leading-[1.55] text-body">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-paper">
          <div className="mx-auto max-w-[860px] px-4 py-14 sm:px-6 md:py-20">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className="mono text-xs uppercase tracking-wider text-muted">In this browser</div>
                <h2 className="mt-1 text-[26px] font-medium tracking-[-0.02em] text-ink sm:text-[30px]">Connect your owner wallet</h2>
              </div>
              <span className={`ml-auto rounded-full px-3 py-1 text-xs ${browserDone ? "bg-[#e6f7f0] text-band-green" : "bg-white text-muted"}`}>
                {[s1, s2, s3].filter((x) => x === "done").length} of 3 done
              </span>
            </div>
            <ol className="mt-6 space-y-3">
              <Step
                n={1}
                state={s1}
                title="Get QIE Wallet"
                action={
                  !hasQie && (
                    <a href={QIE_WALLET_URL} target="_blank" rel="noreferrer" className="whitespace-nowrap rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:bg-paper">
                      Get QIE Wallet ↗
                    </a>
                  )
                }
              >
                {hasQie
                  ? "QIE Wallet is installed in this browser."
                  : w.account
                    ? `Connected with ${w.wallet?.name ?? "your wallet"}. QIE Wallet is recommended, but any EVM wallet that can use QIE works.`
                  : hasWallet
                    ? `Found ${w.wallets.map((x) => x.name).join(", ")}. QIE Wallet is recommended, but any EVM wallet that can switch to QIE works.`
                    : w.mode === "reown"
                      ? "Install the QIE Wallet extension or app. On a phone you can also connect any WalletConnect wallet by scanning a QR code or opening it directly. This wallet becomes the owner of your Tyrell account."
                      : "Install the QIE Wallet extension, or on a phone open this page in the QIE Wallet app's browser. This wallet becomes the owner of your Tyrell account."}
              </Step>
              <Step n={2} state={s2} title="Connect and sign in" action={<ConnectButton />}>
                {w.session
                  ? `Signed in as ${w.account}.`
                  : w.account
                    ? "Connected. Sign the message to prove the wallet is yours: no transaction, no fee."
                    : "Connecting shares your address. Signing in proves you hold it. Neither costs anything."}
              </Step>
              <Step
                n={3}
                state={s3}
                title="Use the QIE network"
                action={
                  w.account &&
                  !onQie && (
                    <button onClick={() => w.switchTo(1990)} className="whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-sm text-white transition-colors hover:bg-brand-deep">
                      Switch to QIE Mainnet
                    </button>
                  )
                }
              >
                {w.account ? `Your wallet is on ${chainName(w.chainId)}.` : "Tyrell's contracts live on QIE Mainnet (chain 1990). Use QIE Testnet (1983) to try it first."}{" "}
                {!onQie && w.account && "Switch, or add QIE if your wallet does not know it yet."}
              </Step>
            </ol>

            <div className="mt-14">
              <div className="mono text-xs uppercase tracking-wider text-muted">On your computer</div>
              <h2 className="mt-1 text-[26px] font-medium tracking-[-0.02em] text-ink sm:text-[30px]">Run Tyrell next to your agent</h2>
              <p className="mt-2 text-[15px] leading-[1.6] text-body">
                The processes that hold keys run on your machine, one key each. The website never holds them: it only makes them, encrypted, for you to download.
              </p>
            </div>
            <ol className="mt-6 space-y-3">
              <Step
                n={4}
                state="todo"
                title="Create your Tyrell account"
                action={
                  <Link href="/console" className="whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-sm text-white transition-colors hover:bg-brand-deep">
                    Open the console
                  </Link>
                }
              >
                In the console, your wallet creates Tyrell&apos;s contracts and registers its keys. Your browser makes the keys, encrypts them with a password you choose, and downloads them as one account file.
              </Step>
              <Step n={5} state="todo" title="Install Tyrell on your computer">
                Node 22 and pnpm 10.
                <Code>{`git clone --recurse-submodules ${REPO}.git tyrell\ncd tyrell && pnpm install`}</Code>
              </Step>
              <Step n={6} state="todo" title="Import your account">
                Puts the keys and contract addresses where the Tyrell processes look for them. It asks for your password.
                <Code>{`pnpm tyrell import ~/Downloads/tyrell-account-${net === "mainnet" ? 1990 : 1983}.json`}</Code>
              </Step>
              <Step n={7} state="todo" title="Start Tyrell">
                Control anchors memories, decides and serves the console. The signer can only pay approved payees. Ingest watches what lands in your wallet.
                <Code>{`pnpm tyrell control start &\npnpm tyrell signer start &\npnpm tyrell ingest start &`}</Code>
              </Step>
              <Step n={8} state="todo" title="Approve who your agent may pay, then let it work">
                Payees are confirmed through QIE ID and signed by you. Your agent can only propose; the policy engine and the vault decide.
                <Code>{`pnpm tyrell payee add --label landlord --qie-id landlord.qie --cap 5 --daily 5\nexport FORTYTWO_API_KEY=...   # Qwen on Fortytwo, or any OpenAI-compatible model\npnpm tyrell steward "pay this month's rent"`}</Code>
              </Step>
              <Step n={9} state="todo" title="Watch it in the console">
                The console shows your account from QIE: keys, payees, payments and activity. For every memory, decision, incident and blast radius, run the web app next to control:
                <Code>{`TYRELL_API_URL=http://127.0.0.1:7878 pnpm web:dev   # then open http://localhost:3000/console`}</Code>
              </Step>
            </ol>

            <div className="mt-10 flex flex-col gap-3 rounded-[20px] bg-night p-6 text-snow sm:flex-row sm:items-center">
              <div>
                <div className="text-[17px] font-medium">Just looking?</div>
                <p className="mt-1 text-sm text-mist">The playground runs a real attack on two AI agents, one with an ordinary wallet and one protected by Tyrell. No wallet needed.</p>
              </div>
              <Link href="/playground" className="shrink-0 whitespace-nowrap rounded-lg bg-brand px-5 py-3 text-center text-[15px] transition-colors hover:bg-brand-deep sm:ml-auto">
                Open the playground
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer view={view} />
    </>
  );
}
