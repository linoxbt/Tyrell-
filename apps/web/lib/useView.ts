"use client";

import { useEffect, useState } from "react";
import type { ViewDocument } from "./view";

/**
 * Loads the view document (live from control, or the read-only snapshot). Live data is refreshed every
 * `intervalMs` while the tab is visible, and at once when it becomes visible again; a snapshot never
 * changes, so it is read once and not polled.
 */
export function useView(intervalMs = 15_000) {
  const [view, setView] = useState<ViewDocument>();
  const [source, setSource] = useState<"live" | "snapshot" | "">("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polling = true;
    const load = async () => {
      try {
        const r = await fetch("/api/view", { cache: "no-store" });
        let doc: unknown;
        try {
          doc = await r.json();
        } catch {
          throw new Error(`HTTP ${r.status}`);
        }
        if (!r.ok) throw new Error((doc as { error?: string })?.error ?? `HTTP ${r.status}`);
        if (!alive) return;
        const src = (r.headers.get("x-tyrell-source") as "live" | "snapshot" | null) ?? "";
        setSource(src);
        setView(doc as ViewDocument);
        setError("");
        if (src === "snapshot") polling = false;
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      if (!alive || !polling || document.hidden) return;
      timer = setTimeout(() => void load().then(schedule), intervalMs);
    };
    const onVisible = () => {
      if (document.hidden || !polling) return;
      void load().then(schedule);
    };
    void load().then(schedule);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
  return { view, source, error };
}
