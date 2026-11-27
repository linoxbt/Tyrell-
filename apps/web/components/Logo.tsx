import { useId } from "react";
import { LEFT, LEFT_MONO, RIGHT, RIGHT_MONO, TILE, WORD, WORD_H, WORD_W } from "./brand";

/*
 * Tyrell's mark: a T made of two halves. The left half is what was signed, the folded half is what the chain
 * anchored. They only form the letter when they meet, which is the rule Tyrell enforces on every memory.
 */

const FIT = "translate(32 32.5) scale(.94) translate(-32 -32.5)";

/** The app-icon mark: the two-key T on the violet tile. */
export function Mark({ size = 28, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8F72FF" />
          <stop offset="1" stopColor="#6A48F0" />
        </linearGradient>
        <linearGradient id={`${id}sh`} x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity=".2" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}fd`} x1="33" y1="13" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E6DEFF" />
          <stop offset="1" stopColor="#B5A1FF" />
        </linearGradient>
      </defs>
      <path d={TILE} fill={`url(#${id}bg)`} />
      <path d={TILE} fill={`url(#${id}sh)`} />
      <g transform={FIT}>
        <path d={LEFT} fill="#fff" />
        <path d={RIGHT} fill={`url(#${id}fd)`} />
      </g>
    </svg>
  );
}

/** The T without its tile. `brand` for light backgrounds, `light` for dark ones, `mono` takes the text colour. */
export function Glyph({ size = 28, tone = "brand", className = "" }: { size?: number; tone?: "brand" | "light" | "mono"; className?: string }) {
  const id = useId().replace(/:/g, "");
  if (tone === "mono")
    return (
      <svg width={size} height={size} viewBox="12 13 40 39" className={className} fill="currentColor" aria-hidden>
        <path d={LEFT_MONO} />
        <path d={RIGHT_MONO} />
      </svg>
    );
  const [a, f0, f1] = tone === "brand" ? ["#7C5CFF", "#C9BCFF", "#9B83FF"] : ["#FFFFFF", "#E6DEFF", "#B5A1FF"];
  return (
    <svg width={size} height={size} viewBox="12 13 40 39" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}fd`} x1="33" y1="13" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor={f0} />
          <stop offset="1" stopColor={f1} />
        </linearGradient>
      </defs>
      <path d={LEFT} fill={a} />
      <path d={RIGHT} fill={`url(#${id}fd)`} />
    </svg>
  );
}

/** "Tyrell" outlined from Geist SemiBold, so it renders identically everywhere. Height is the cap height + descender. */
export function Type({ height = 22, className = "" }: { height?: number; className?: string }) {
  return (
    <svg height={height} viewBox={`0 0 ${WORD_W} ${WORD_H}`} className={className} fill="currentColor" role="img" aria-label="Tyrell">
      {WORD.map((w, i) => (
        <path key={i} transform={`translate(${w.x} 0)`} d={w.d} />
      ))}
    </svg>
  );
}

/** The lockup: mark at 1.62x the cap height, a 0.36x gap, the wordmark aligned to the mark's centre. */
export function Wordmark({ dark = false, size = 28 }: { dark?: boolean; size?: number }) {
  const cap = size / 1.62;
  return (
    <span className="flex items-center" style={{ gap: size * 0.36 }}>
      <Mark size={size} />
      <Type height={(cap * WORD_H) / 710} className={dark ? "text-snow" : "text-ink"} />
    </span>
  );
}
