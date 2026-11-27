"use client";

import { WalletSheet } from "@/components/wallet/Wallet";
import { ReownWalletProvider, reownEnabled } from "@/lib/reown";
import { InjectedWalletProvider } from "@/lib/wallet";

/** Reown AppKit when a project id is configured; browser wallets only otherwise. */
const WalletProvider = reownEnabled ? ReownWalletProvider : InjectedWalletProvider;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      {children}
      <WalletSheet />
    </WalletProvider>
  );
}
