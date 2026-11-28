"use client";

import { useEffect, useState } from "react";
import type { ViewDocument } from "./view";

/** Loads the view document (live from control, or the read-only snapshot) and refreshes it. */
export function useView(intervalMs = 15_000) {
  const [view, setView] = useState<ViewDocument>();
  const [source, setSource] = useState<"live" | "snapshot" | "">("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/view", { cache: "no-store" });
        if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? `HTTP ${r.status}`);
        const doc = (await r.json()) as ViewDocument;
        if (!alive) return;
        setSource((r.headers.get("x-tyrell-source") as "live" | "snapshot") ?? "");
        setView(doc);
        setError("");
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);
  return { view, source, error };
}
