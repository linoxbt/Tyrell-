"use client";

import { useEffect, type MutableRefObject } from "react";
import { WalletSheet } from "@/components/wallet/Wallet";
import { ReownWalletProvider, reownEnabled } from "@/lib/reown";
import { InjectedWalletProvider, useWallet, type WalletCtx } from "@/lib/wallet";

/** Reown AppKit when a project id is configured; browser wallets only otherwise. Loaded on demand (see providers.tsx). */
const WalletProvider = reownEnabled ? ReownWalletProvider : InjectedWalletProvider;

export interface RuntimeProps {
  onValue: (v: WalletCtx) => void;
  /** Set when a Connect button was pressed before the stack had loaded: open it once it is ready. */
  openOnLoad: MutableRefObject<boolean>;
}

export function WalletRuntime({ onValue, openOnLoad }: RuntimeProps) {
  return (
    <WalletProvider>
      <Report onValue={onValue} openOnLoad={openOnLoad} />
      <WalletSheet />
    </WalletProvider>
  );
}

function Report({ onValue, openOnLoad }: RuntimeProps) {
  const w = useWallet();
  useEffect(() => onValue(w), [w, onValue]);
  useEffect(() => {
    if (!openOnLoad.current) return;
    openOnLoad.current = false;
    w.openSheet();
  }, [w, openOnLoad]);
  return null;
}
