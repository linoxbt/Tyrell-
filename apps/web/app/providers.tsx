"use client";

import { WalletSheet } from "@/components/wallet/Wallet";
import { WalletProvider } from "@/lib/wallet";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      {children}
      <WalletSheet />
    </WalletProvider>
  );
}
