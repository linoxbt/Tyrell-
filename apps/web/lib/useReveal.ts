"use client";

import { useEffect } from "react";

/**
 * Eases section headings and cards in as they enter the viewport. Everything past the hero is
 * observed; elements already on screen reveal at once, and nothing is hidden without JavaScript.
 */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("main > section:not(:first-child) :is(h2, .grid > *, [data-reveal])")).filter(
      (el) => !el.closest("[data-no-reveal]") && el.parentElement?.tagName !== "LI" && !el.classList.contains("in"),
    );
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    for (const el of els) {
      const sibs = el.parentElement ? Array.from(el.parentElement.children) : [];
      el.style.transitionDelay = `${Math.min(sibs.indexOf(el), 5) * 70}ms`;
      el.classList.add("reveal");
      io.observe(el);
    }
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
