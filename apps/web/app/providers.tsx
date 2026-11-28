"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { LAST_WALLET, SESSION, WALLET_MODE, WalletContext, type WalletCtx } from "@/lib/wallet";
import type { RuntimeProps } from "./wallet-runtime";

/*
 * The wallet stack (Reown AppKit + wagmi, or the browser-wallet picker) is a large bundle, so it loads only
 * where it is needed: at once on the pages that use the wallet (the console and get-started), on the first
 * click of a Connect button anywhere else, and in the background for a returning visitor who connected
 * before (so the header shows their account). Until then, pages get a stand-in context whose Connect button
 * loads the stack and opens it.
 *
 * The real provider renders next to the page, not around it, and reports its value up, so loading it never
 * remounts the page.
 */

const EAGER = ["/console", "/start"];

function returning(): boolean {
  try {
    return !!(localStorage.getItem(SESSION) || localStorage.getItem(LAST_WALLET) || document.cookie.includes("wagmi."));
  } catch {
    return false;
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [Runtime, setRuntime] = useState<ComponentType<RuntimeProps>>();
  const [value, setValue] = useState<WalletCtx>();
  const openOnLoad = useRef(false);
  const loading = useRef(false);

  const load = useCallback((open: boolean) => {
    if (open) openOnLoad.current = true;
    if (loading.current) return;
    loading.current = true;
    void import("./wallet-runtime")
      .then((m) => setRuntime(() => m.WalletRuntime))
      .catch(() => {
        loading.current = false; // a failed chunk download can be retried by the next click
      });
  }, []);

  useEffect(() => {
    if (EAGER.some((p) => pathname === p || pathname.startsWith(`${p}/`))) load(false);
    else if (returning()) {
      const idle = (window as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
      if (idle) idle(() => load(false));
      else setTimeout(() => load(false), 1500);
    }
  }, [pathname, load]);

  const stub = useMemo<WalletCtx>(
    () => ({
      mode: WALLET_MODE,
      wallets: [],
      ready: false,
      sheetOpen: false,
      openSheet: () => load(true),
      closeSheet: () => undefined,
      connect: async () => load(true),
      signIn: async () => load(true),
      switchTo: async () => load(true),
      disconnect: () => undefined,
    }),
    [load],
  );

  return (
    <WalletContext.Provider value={value ?? stub}>
      {children}
      {Runtime && <Runtime onValue={setValue} openOnLoad={openOnLoad} />}
    </WalletContext.Provider>
  );
}
