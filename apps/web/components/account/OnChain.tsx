"use client";

import { formatUnits } from "viem";
import { LANES, noKey, type AccountState, type Deployment } from "@/lib/account";
import { CHAINS } from "@/lib/wallet";

/* The account read straight from QIE: what is set up, what has happened, and what to do next. */

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const LANE: Record<number, string> = { 1: "user", 2: "agent", 3: "wallet", 4: "control" };

function explorer(chainId: number, kind: "address" | "tx", v: string) {
  const base = CHAINS[chainId]?.explorer;
  return base ? `${base}/${kind}/${v}` : undefined;
}
function Addr({ chainId, a }: { chainId: number; a: string }) {
  const href = explorer(chainId, "address", a);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="mono text-brand hover:underline">
      {short(a)}
    </a>
  ) : (
    <span className="mono">{short(a)}</span>
  );
}

function Card({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3.5">
      <div className="text-[13px] text-body">{label}</div>
      <div className="mt-1.5 text-[26px] font-medium tracking-tight text-ink">{value}</div>
      <div className={`mt-0.5 text-[12px] ${tone === "good" ? "text-band-green" : tone === "warn" ? "text-amber" : "text-muted"}`}>{note}</div>
    </div>
  );
}

export function AccountOverview({ d, s, onTab }: { d: Deployment; s: AccountState; onTab: (t: "keys" | "payees" | "activity") => void }) {
  const keysSet = LANES.filter((l) => !noKey(s.keys[l.lane])).length;
  const activePayees = s.payees.filter((p) => p.active && !p.suspended).length;
  const fmt = (n: bigint) => Number(formatUnits(n, s.token.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const todo = [
    ...s.gas.filter((g) => g.balance === 0n).map((g) => ({ t: `Give your ${g.name} key a little QIE for gas`, d: `It pays the fee to ${g.name === "submitter" ? "record memories" : "execute payments"}. Send some QIE to ${g.address}` })),
    keysSet < 4 && { t: `Add the missing ${4 - keysSet === 1 ? "key" : "keys"}`, d: "Every part of Tyrell needs its own key before it can write.", a: () => onTab("keys"), cta: "Open keys" },
    activePayees === 0 && { t: "Approve your first payee", d: "Tyrell only ever pays people you approve.", code: 'pnpm tyrell payee add --label landlord --address 0x… --cap 5 --daily 5' },
    s.token.vaultBalance === 0n && { t: `Fund your vault with ${s.token.symbol}`, d: `Send ${s.token.symbol} to your vault address: ${d.guardedVault}` },
    s.memories.total === 0 && { t: "Start Tyrell on your computer", d: "Then tell it what to pay, and it remembers it here.", code: "pnpm tyrell control start" },
  ].filter(Boolean) as Array<{ t: string; d: string; a?: () => void; cta?: string; code?: string }>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card label="Lane keys" value={`${keysSet}/4`} note={keysSet === 4 ? "all set" : "some missing"} tone={keysSet === 4 ? "good" : "warn"} />
        <Card label="Approved payees" value={String(activePayees)} note={s.payees.length > activePayees ? `${s.payees.length - activePayees} suspended or removed` : "Tyrell pays only these"} />
        <Card label="Memories recorded" value={String(s.memories.total)} note="signed and anchored on QIE" />
        <Card label="Vault balance" value={`${fmt(s.token.vaultBalance)}`} note={s.token.symbol} tone={s.token.vaultBalance > 0n ? "good" : "warn"} />
      </div>

      {todo.length > 0 && (
        <section className="rounded-xl border border-brand/30 bg-white p-5">
          <h3 className="text-[16px] font-medium text-ink">Finish setting up</h3>
          <ol className="mt-3 space-y-3">
            {todo.map((x, i) => (
              <li key={x.t} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-[12px] text-brand">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-ink">{x.t}</div>
                  <div className="text-[13px] text-body [overflow-wrap:anywhere]">{x.d}</div>
                  {x.code && <pre className="mono mt-1.5 overflow-x-auto rounded-lg bg-paper px-3 py-2 text-[12px] text-ink">{x.code}</pre>}
                  {x.a && (
                    <button onClick={x.a} className="mt-1.5 text-[13px] text-brand hover:underline">
                      {x.cta} →
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-white p-5">
          <h3 className="mono text-[12px] uppercase tracking-wider text-muted">Recent payments</h3>
          {s.payments.length === 0 ? <p className="mt-3 text-[14px] text-muted">No payments yet.</p> : <Payments d={d} s={s} limit={5} />}
        </section>
        <section className="rounded-xl border border-line bg-white p-5">
          <h3 className="mono text-[12px] uppercase tracking-wider text-muted">Account contracts</h3>
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
            {(
              [
                ["Owner", d.owner],
                ["Key registry", d.laneRegistry],
                ["Memory log", d.memoryAnchor],
                ["Payee ledger", d.tyrellLedger],
                ["Vault", d.guardedVault],
                [`Token (${s.token.symbol})`, d.token],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd>
                  <Addr chainId={d.chainId} a={v} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

function Payments({ d, s, limit }: { d: Deployment; s: AccountState; limit?: number }) {
  return (
    <ul className="mt-2 divide-y divide-line text-[14px]">
      {s.payments.slice(0, limit).map((p) => {
        const label = s.payees.find((x) => x.addr.toLowerCase() === p.to.toLowerCase())?.label;
        const href = explorer(d.chainId, "tx", p.tx);
        return (
          <li key={p.tx} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
            <span className="font-medium text-ink">
              {formatUnits(p.amount, s.token.decimals)} {s.token.symbol}
            </span>
            <span className="text-body">to {label ?? short(p.to)}</span>
            <span className="ml-auto text-[12px] text-muted">
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="hover:text-brand">
                  block {p.block.toString()}
                </a>
              ) : (
                `block ${p.block}`
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function AccountPayees({ d, s }: { d: Deployment; s: AccountState }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h3 className="mono text-[12px] uppercase tracking-wider text-muted">Approved payees</h3>
      <p className="mt-1 text-[13px] text-muted">The only addresses your vault can pay. Adding one needs your user key, so the AI can never add one.</p>
      {s.payees.length === 0 ? (
        <div className="mt-4 text-[14px] text-body">
          No payees yet. On the computer that runs Tyrell:
          <pre className="mono mt-2 overflow-x-auto rounded-lg bg-paper px-3 py-2 text-[12px] text-ink">pnpm tyrell payee add --label landlord --address 0x… --cap 5 --daily 5</pre>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-line text-[14px]">
          {s.payees.map((p) => (
            <li key={p.payeeId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="font-medium text-ink">{p.label}</span>
              <Addr chainId={d.chainId} a={p.addr} />
              <span className="text-[13px] text-muted">
                up to {formatUnits(p.capPerTx, s.token.decimals)} per payment · {formatUnits(p.capPerDay, s.token.decimals)} a day
              </span>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-[12px] ${!p.active ? "bg-paper text-muted" : p.suspended ? "bg-[#ffe9ed] text-rose" : "bg-[#e6f7f0] text-band-green"}`}>
                {!p.active ? "removed" : p.suspended ? "suspended" : "active"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AccountActivity({ d, s }: { d: Deployment; s: AccountState }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-line bg-white p-5">
        <h3 className="mono text-[12px] uppercase tracking-wider text-muted">Memories recorded</h3>
        <p className="mt-1 text-[13px] text-muted">
          {s.memories.total} in total
          {Object.keys(s.memories.byLane).length ? ` · ${Object.entries(s.memories.byLane).map(([l, n]) => `${LANE[Number(l)]} ${n}`).join(" · ")}` : ""}. Their content stays encrypted on your computer; QIE holds the signed fingerprints.
        </p>
        {s.memories.recent.length === 0 ? (
          <p className="mt-3 text-[14px] text-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-[14px]">
            {s.memories.recent.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <span className="rounded-full bg-paper px-2 py-0.5 text-[12px] text-body">{LANE[m.lane] ?? m.lane}</span>
                <span className="mono text-[13px] text-ink">{short(m.id)}</span>
                <span className="text-[12px] text-muted">signed by {short(m.signer)}</span>
                <span className="ml-auto text-[12px] text-muted">block {m.block.toString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-line bg-white p-5">
        <h3 className="mono text-[12px] uppercase tracking-wider text-muted">Payments</h3>
        {s.payments.length === 0 ? <p className="mt-3 text-[14px] text-muted">No payments yet.</p> : <Payments d={d} s={s} />}
        <p className="mt-3 text-[12px] text-muted">{s.activeSeeds ? `${s.activeSeeds} quarantine in force.` : "No quarantine in force."}</p>
      </section>
    </div>
  );
}
