import Link from "next/link";

export const REPO = "https://github.com/linoxbt/Tyrell-";

/** Section eyebrow: the template's small rounded pill above every heading. */
export function Pill({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span className={`inline-block rounded-full border px-3 py-1 text-sm ${dark ? "border-white/40 text-white" : "border-line bg-white text-muted shadow-[0_1px_2px_rgba(15,18,32,0.06)]"}`}>{children}</span>
  );
}

export function SectionHead({ pill, title, lead, dark = false, className = "" }: { pill: string; title: React.ReactNode; lead?: string; dark?: boolean; className?: string }) {
  return (
    <div className={`mx-auto max-w-[860px] text-center ${className}`}>
      <Pill dark={dark}>{pill}</Pill>
      <h2 className={`h-section mt-5 ${dark ? "text-snow" : "text-ink"}`}>{title}</h2>
      {lead && <p className={`t-lead mx-auto mt-4 max-w-[680px] ${dark ? "text-mist" : "text-body"}`}>{lead}</p>}
    </div>
  );
}

/** The template's two button styles: filled violet and violet outline. */
export function Button({ href, children, variant = "primary", className = "" }: { href: string; children: React.ReactNode; variant?: "primary" | "outline" | "dark" | "white"; className?: string }) {
  const styles = {
    primary: "bg-brand text-snow hover:bg-brand-deep",
    outline: "border border-brand text-brand hover:bg-brand-50",
    dark: "bg-night-2 text-white hover:bg-[#303235]",
    white: "border border-line bg-white text-ink hover:bg-paper",
  }[variant];
  const cls = `inline-flex items-center justify-center rounded-lg px-6 py-4 text-base leading-none transition-colors ${styles} ${className}`;
  return href.startsWith("/") || href.startsWith("#") ? (
    <Link href={href} className={cls}>{children}</Link>
  ) : (
    <a href={href} className={cls}>{children}</a>
  );
}

export function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The KPI sparkline: a row of rounded bars, the last one emphasised. */
export function Bars({ values, color, count = 22 }: { values: number[]; color: string; count?: number }) {
  const v = values.length ? values.slice(-count) : [0];
  const max = Math.max(...v, 1);
  const pad = Array.from({ length: Math.max(0, count - v.length) }, () => 0);
  const all = [...pad, ...v];
  return (
    <div className="flex h-7 items-end gap-[5px]">
      {all.map((x, i) => (
        <span key={i} className="w-[5px] rounded-full" style={{ height: `${Math.max(14, (x / max) * 100)}%`, background: color, opacity: i === all.length - 1 ? 1 : 0.55 }} />
      ))}
    </div>
  );
}

/** Small line icons for the app rail. */
export function Icon({ name, className = "" }: { name: "pulse" | "check" | "shield" | "coin" | "gear" | "graph" | "flag" | "list"; className?: string }) {
  const p = {
    pulse: "M2 12h4l3-7 4 14 3-7h6",
    check: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6",
    shield: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z",
    coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v1.5M12 16v1.5",
    gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.3-.9-2 3.4 2 1.5a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9c.5.4 1.1.8 1.7 1l.4 2.5h4l.4-2.5c.6-.2 1.2-.6 1.7-1l2.3.9 2-3.4z",
    graph: "M6 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7 7.8l4 8.4M17 7.8l-4 8.4",
    flag: "M5 21V4h11l-2 4 2 4H5",
    list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  }[name];
  return (
    <svg viewBox="0 0 24 24" className={`h-5 w-5 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={p} />
    </svg>
  );
}
