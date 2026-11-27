"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** "On this page", with the heading in view highlighted. */
export function Toc({ items }: { items: Array<{ depth: 2 | 3; text: string; id: string }> }) {
  const [active, setActive] = useState<string>();
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-110px 0px -65% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [items]);
  if (!items.length) return null;
  return (
    <nav aria-label="On this page" className="text-[13px]">
      <div className="mb-3 font-medium text-ink">On this page</div>
      <ul className="space-y-1.5 border-l border-line">
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} className={`-ml-px block border-l-2 py-0.5 transition-colors ${i.depth === 3 ? "pl-6" : "pl-3"} ${active === i.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>
              {i.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Copy buttons on every code block, and a language label. */
export function CodeCopy() {
  const path = usePathname();
  useEffect(() => {
    const pres = Array.from(document.querySelectorAll<HTMLPreElement>(".prose-docs pre"));
    for (const pre of pres) {
      if (pre.parentElement?.classList.contains("code-wrap")) continue;
      const wrap = document.createElement("div");
      wrap.className = "code-wrap";
      pre.parentElement!.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const bar = document.createElement("div");
      bar.className = "code-bar";
      const lang = (pre.className.match(/language-(\w+)/)?.[1] ?? pre.querySelector("code")?.className.match(/language-(\w+)/)?.[1] ?? "").replace("text", "");
      const label = document.createElement("span");
      label.textContent = lang;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Copy";
      btn.setAttribute("aria-label", "Copy code");
      btn.onclick = async () => {
        await navigator.clipboard.writeText(pre.innerText);
        btn.textContent = "Copied ✓";
        setTimeout(() => (btn.textContent = "Copy"), 1400);
      };
      bar.append(label, btn);
      wrap.insertBefore(bar, pre);
    }
  }, [path]);
  return null;
}
