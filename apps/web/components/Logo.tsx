/** Tyrell's mark: a T whose stem ends in a provenance node, on the brand violet. */
export function Mark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--color-brand)" />
      <path d="M8.5 10.5h15" stroke="white" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M16 10.5v8.2" stroke="white" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="16" cy="23.2" r="2.9" fill="white" />
      <path d="M11.2 18.7l2.4 2.6M20.8 18.7l-2.4 2.6" stroke="white" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Mark />
      <span className={`text-[22px] font-semibold tracking-[-0.04em] ${dark ? "text-white" : "text-ink"}`}>Tyrell</span>
    </span>
  );
}
