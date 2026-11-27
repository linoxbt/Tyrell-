"use client";

import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { defineChain, type AppKitNetwork } from "@reown/appkit/networks";
import { createAppKit, useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitProvider, useDisconnect, useWalletInfo } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { WagmiProvider, cookieStorage, createStorage } from "wagmi";
import {
  CHAINS,
  QIE_WALLET_LINKS,
  QIE_WALLET_RDNS,
  QIE_WALLET_URL,
  WalletContext,
  clearSession,
  errText,
  loadSession,
  signInWith,
  switchWith,
  useDiscoveredWallets,
  type DetectedWallet,
  type Eip1193,
  type Session,
  type WalletCtx,
} from "./wallet";

/*
 * Reown AppKit (formerly WalletConnect's Web3Modal) for the wallet connection: browser wallets over
 * EIP-6963 (QIE Wallet shows up as soon as it is installed), mobile wallets over WalletConnect with a
 * QR code or a deep link, and Reown's wallet directory. Tyrell only needs a real wallet the owner
 * controls, so email/social logins, swaps, on-ramp and analytics are off.
 *
 * NEXT_PUBLIC_REOWN_PROJECT_ID comes from https://dashboard.reown.com. It is public by design (it
 * ships in the page); the project's domain allowlist is what restricts where it can be used.
 */

export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
export const reownEnabled = REOWN_PROJECT_ID.length > 0;

const qie = (id: 1990 | 1983, testnet: boolean) => {
  const c = CHAINS[id]!;
  return defineChain({
    id,
    caipNetworkId: `eip155:${id}`,
    chainNamespace: "eip155",
    name: c.name,
    nativeCurrency: { name: "QIE", symbol: "QIEV3", decimals: 18 },
    rpcUrls: { default: { http: c.rpcUrls } },
    blockExplorers: {
      default: {
        name: testnet ? "QIE Testnet Explorer" : "QIE Explorer",
        url: c.explorer!,
      },
    },
    testnet,
  });
};
export const qieMainnet = qie(1990, false);
export const qieTestnet = qie(1983, true);
const networks: [AppKitNetwork, ...AppKitNetwork[]] = [qieMainnet, qieTestnet];

let adapter: WagmiAdapter | undefined;

/** Is QIE Wallet installed? Extensions answer an EIP-6963 request synchronously, so ask once at start-up. */
function qieWalletInstalled(): boolean {
  if (typeof window === "undefined") return false;
  let found = false;
  const on = (e: Event) => {
    if ((e as CustomEvent<{ info?: { rdns?: string } }>).detail?.info?.rdns === QIE_WALLET_RDNS) found = true;
  };
  window.addEventListener("eip6963:announceProvider", on);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  window.removeEventListener("eip6963:announceProvider", on);
  return found;
}

/** Create AppKit once, before any of its hooks run (module scope, as Reown requires). */
function init(): WagmiAdapter | undefined {
  if (adapter || !reownEnabled) return adapter;
  adapter = new WagmiAdapter({
    projectId: REOWN_PROJECT_ID,
    networks,
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
  });
  const origin = typeof window !== "undefined" ? window.location.origin : "https://tyrell-mu.vercel.app";
  createAppKit({
    adapters: [adapter],
    projectId: REOWN_PROJECT_ID,
    networks,
    defaultNetwork: qieMainnet,
    // a local demo chain (the console's snapshot) is still usable through the raw wallet provider
    allowUnsupportedChain: true,
    metadata: {
      name: "Tyrell",
      description: "Memory provenance and guarded payments for AI agents, on QIE.",
      url: origin,
      icons: [`${origin}/apple-icon.png`],
    },
    features: {
      analytics: false,
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
      history: false,
      send: false,
      receive: false,
    },
    // when QIE Wallet is installed AppKit lists it already (EIP-6963); otherwise offer the download
    customWallets: qieWalletInstalled()
      ? []
      : [
          {
            id: "qie-wallet",
            name: "QIE Wallet",
            homepage: QIE_WALLET_URL,
            image_url: `${origin}/brand/qie-wallet.png`, // served from this site: AppKit fetches icons with CORS
            desktop_link: QIE_WALLET_LINKS.chrome,
            app_store: QIE_WALLET_LINKS.ios,
            play_store: QIE_WALLET_LINKS.android,
          },
        ],
    themeMode: "light",
    themeVariables: {
      "--apkt-accent": "#7C5CFF",
      "--w3m-accent": "#7C5CFF",
      "--apkt-font-family": "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
      "--w3m-font-family": "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
      "--apkt-border-radius-master": "3px",
      "--w3m-border-radius-master": "3px",
      "--apkt-z-index": 70,
      "--w3m-z-index": 70,
    },
  });
  return adapter;
}
init();

const queryClient = new QueryClient();

/** `useWallet()` backed by Reown AppKit. Tyrell's own sheet handles sign-in once connected. */
export function ReownWalletProvider({ children }: { children: React.ReactNode }) {
  const a = init()!;
  return (
    <WagmiProvider config={a.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Bridge>{children}</Bridge>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function Bridge({ children }: { children: React.ReactNode }) {
  const { wallets, ready } = useDiscoveredWallets();
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount({ namespace: "eip155" });
  const { chainId: rawChain } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<Eip1193>("eip155");
  const { walletInfo } = useWalletInfo("eip155");
  const { disconnect: appkitDisconnect } = useDisconnect();

  const [session, setSession] = useState<Session>();
  const [busy, setBusy] = useState<WalletCtx["busy"]>();
  const [error, setError] = useState<string>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [liveChain, setLiveChain] = useState<number>();

  const account = isConnected && address && isAddress(address) ? (getAddress(address) as Address) : undefined;
  // AppKit only tracks networks it was configured with; ask the wallet for anything else (e.g. a local chain)
  const chainId = liveChain ?? (typeof rawChain === "number" ? rawChain : rawChain ? Number(rawChain) : undefined);

  useEffect(() => setSession(loadSession(account)), [account]);
  useEffect(() => {
    setLiveChain(undefined);
    if (!walletProvider || !account) return;
    let stop = false;
    const read = () =>
      walletProvider
        .request({ method: "eth_chainId" })
        .then((id) => !stop && setLiveChain(Number(id)))
        .catch(() => undefined);
    void read();
    const on = () => void read();
    walletProvider.on?.("chainChanged", on as never);
    return () => {
      stop = true;
      walletProvider.removeListener?.("chainChanged", on as never);
    };
  }, [walletProvider, account, rawChain]);

  const wallet: DetectedWallet | undefined = useMemo(
    () =>
      account && walletProvider
        ? {
            uuid: "reown",
            name: walletInfo?.name ?? "Wallet",
            icon: walletInfo?.icon ?? "",
            rdns: "reown",
            provider: walletProvider,
          }
        : undefined,
    [account, walletProvider, walletInfo?.name, walletInfo?.icon],
  );

  const signIn = useCallback(async () => {
    if (!walletProvider || !account) return;
    setError(undefined);
    setBusy("signing");
    try {
      setSession(await signInWith(walletProvider, account, chainId));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(undefined);
    }
  }, [walletProvider, account, chainId]);

  const switchTo = useCallback(
    async (id: number) => {
      if (!walletProvider) return;
      setError(undefined);
      setBusy("switching");
      try {
        await switchWith(walletProvider, id);
        setLiveChain(Number(await walletProvider.request({ method: "eth_chainId" })));
      } catch (e) {
        setError(errText(e));
      } finally {
        setBusy(undefined);
      }
    },
    [walletProvider],
  );

  const disconnect = useCallback(() => {
    clearSession();
    setSession(undefined);
    setError(undefined);
    setSheetOpen(false);
    void appkitDisconnect().catch(() => undefined);
  }, [appkitDisconnect]);

  const value = useMemo<WalletCtx>(
    () => ({
      mode: "reown",
      wallets,
      ready,
      wallet,
      account,
      chainId,
      session,
      busy,
      error,
      sheetOpen,
      openSheet: () => {
        setError(undefined);
        if (account) setSheetOpen(true);
        else void open({ view: "Connect" });
      },
      closeSheet: () => setSheetOpen(false),
      // AppKit's modal does the connecting; this keeps the shared interface for the injected picker
      connect: async () => void (await open({ view: "Connect" })),
      signIn,
      switchTo,
      disconnect,
      manage: () => {
        setSheetOpen(false);
        void open({ view: "Account" });
      },
    }),
    [wallets, ready, wallet, account, chainId, session, busy, error, sheetOpen, open, signIn, switchTo, disconnect],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
