"use client";

import { useEffect, useState } from "react";
import type { ViewDocument } from "./view";

/**
 * Sample data for the landing page's product illustrations (public/snapshot.json, a recorded run).
 * The console never uses it: it shows your own account.
 */
export function useSample() {
  const [view, setView] = useState<ViewDocument>();
  useEffect(() => {
    void fetch("/snapshot.json")
      .then((r) => (r.ok ? (r.json() as Promise<ViewDocument>) : undefined))
      .then(setView)
      .catch(() => undefined);
  }, []);
  return { view };
}
