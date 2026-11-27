"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress, toHex, verifyMessage, type Address, type Hex } from "viem";

/*
 * Wallet login for the Tyrell web app.
 *
 * Wallets are discovered with EIP-6963 (QIE Wallet announces itself as rdns "me.qiewallet"), with the
 * legacy window.ethereum as a fallback. "Signing in" is an EIP-4361 message the wallet signs and the
 * page verifies locally: it proves control of the address, costs nothing and sends no transaction.
 * Nothing here can move funds; on-chain actions are separate, explicit wallet transactions.
 */

export const QIE_WALLET_RDNS = "me.qiewallet";
export const QIE_WALLET_URL = "https://www.qiewallet.me";

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, fn: (...a: never[]) => void): void;
  removeListener?(event: string, fn: (...a: never[]) => void): void;
}

export interface DetectedWallet {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
  provider: Eip1193;
}

export interface ChainParams {
  id: number;
  name: string;
  short: string;
  rpcUrls: string[];
  explorer?: string;
  testnet?: boolean;
}

export const CHAINS: Record<number, ChainParams> = {
  1990: {
    id: 1990,
    name: "QIE Mainnet",
    short: "mainnet",
    rpcUrls: ["https://rpc1mainnet.qie.digital", "https://rpc2mainnet.qie.digital"],
    explorer: "https://mainnet.qie.digital",
  },
  1983: {
    id: 1983,
    name: "QIE Testnet",
    short: "testnet",
    rpcUrls: ["https://rpc4testnet.qie.digital", "https://rpc5testnet.qie.digital"],
    explorer: "https://testnet.qie.digital",
    testnet: true,
  },
  31337: { id: 31337, name: "Local chain (anvil)", short: "local", rpcUrls: ["http://127.0.0.1:8545"], testnet: true },
};

export const chainName = (id?: number) => (id ? (CHAINS[id]?.name ?? `Chain ${id}`) : "No network");

export interface Session {
  address: Address;
  chainId: number;
  message: string;
  signature: Hex;
  issuedAt: string;
  expiresAt: string;
}

interface WalletCtx {
  wallets: DetectedWallet[];
  ready: boolean;
  wallet?: DetectedWallet;
  account?: Address;
  chainId?: number;
  session?: Session;
  busy?: "connecting" | "signing" | "switching";
  error?: string;
  sheetOpen: boolean;
  openSheet(): void;
  closeSheet(): void;
  connect(w: DetectedWallet): Promise<void>;
  signIn(): Promise<void>;
  switchTo(chainId: number): Promise<void>;
  disconnect(): void;
}

const Ctx = createContext<WalletCtx | null>(null);
const LAST = "tyrell.wallet.rdns";
const SESSION = "tyrell.wallet.session";

/** The EIP-4361 ("Sign-In with Ethereum") message the wallet signs. */
export function signInMessage(o: { host: string; origin: string; address: Address; chainId: number; nonce: string; issuedAt: string; expiresAt: string }): string {
  return [
    `${o.host} wants you to sign in with your Ethereum account:`,
    o.address,
    "",
    "Sign in to Tyrell. This proves you hold this wallet. It is not a transaction and costs nothing.",
    "",
    `URI: ${o.origin}`,
    "Version: 1",
    `Chain ID: ${o.chainId}`,
    `Nonce: ${o.nonce}`,
    `Issued At: ${o.issuedAt}`,
    `Expiration Time: ${o.expiresAt}`,
  ].join("\n");
}

function loadSession(address?: Address): Session | undefined {
  if (!address || typeof localStorage === "undefined") return undefined;
  try {
    const s = JSON.parse(localStorage.getItem(SESSION) ?? "null") as Session | null;
    if (!s || s.address.toLowerCase() !== address.toLowerCase() || Date.parse(s.expiresAt) < Date.now()) return undefined;
    return s;
  } catch {
    return undefined;
  }
}

const errText = (e: unknown) => {
  const x = e as { code?: number; shortMessage?: string; message?: string };
  if (x?.code === 4001) return "You declined the request in your wallet.";
  if (x?.code === -32002) return "Your wallet already has a request open. Check the wallet window.";
  return x?.shortMessage ?? x?.message ?? String(e);
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [ready, setReady] = useState(false);
  const [wallet, setWallet] = useState<DetectedWallet>();
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [session, setSession] = useState<Session>();
  const [busy, setBusy] = useState<WalletCtx["busy"]>();
  const [error, setError] = useState<string>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const found = useRef(new Map<string, DetectedWallet>());

  // 1. discover wallets (EIP-6963), falling back to window.ethereum
  useEffect(() => {
    const add = (w: DetectedWallet) => {
      if (found.current.has(w.rdns)) return;
      found.current.set(w.rdns, w);
      // QIE Wallet first, then alphabetical
      setWallets([...found.current.values()].sort((a, b) => (a.rdns === QIE_WALLET_RDNS ? -1 : b.rdns === QIE_WALLET_RDNS ? 1 : a.name.localeCompare(b.name))));
    };
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ info: Omit<DetectedWallet, "provider">; provider: Eip1193 }>).detail;
      if (d?.info?.rdns && d.provider) add({ ...d.info, provider: d.provider });
    };
    window.addEventListener("eip6963:announceProvider", on);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => {
      const eth = (window as unknown as { ethereum?: Eip1193 & { isMetaMask?: boolean } }).ethereum;
      if (found.current.size === 0 && eth) add({ uuid: "injected", name: eth.isMetaMask ? "MetaMask" : "Browser wallet", icon: "", rdns: "injected", provider: eth });
      setReady(true);
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", on);
      clearTimeout(t);
    };
  }, []);

  // 2. reconnect silently to the last wallet (eth_accounts never prompts)
  useEffect(() => {
    if (!ready || wallet) return;
    const last = localStorage.getItem(LAST);
    const w = wallets.find((x) => x.rdns === last);
    if (!w) return;
    (async () => {
      try {
        const accts = (await w.provider.request({ method: "eth_accounts" })) as string[];
        if (!accts[0] || !isAddress(accts[0])) return;
        const a = getAddress(accts[0]);
        setWallet(w);
        setAccount(a);
        setChainId(Number(await w.provider.request({ method: "eth_chainId" })));
        setSession(loadSession(a));
      } catch {
        /* the wallet is locked or gone: stay disconnected */
      }
    })();
  }, [ready, wallets, wallet]);

  // 3. follow account and network changes
  useEffect(() => {
    const p = wallet?.provider;
    if (!p?.on) return;
    const onAccounts = (accts: string[]) => {
      const a = accts[0] && isAddress(accts[0]) ? getAddress(accts[0]) : undefined;
      setAccount(a);
      setSession(loadSession(a));
      if (!a) setWallet(undefined);
    };
    const onChain = (id: string) => setChainId(Number(id));
    p.on("accountsChanged", onAccounts as never);
    p.on("chainChanged", onChain as never);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts as never);
      p.removeListener?.("chainChanged", onChain as never);
    };
  }, [wallet]);

  const connect = useCallback(async (w: DetectedWallet) => {
    setError(undefined);
    setBusy("connecting");
    try {
      const accts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accts[0]) throw new Error("The wallet returned no account.");
      const a = getAddress(accts[0]);
      setWallet(w);
      setAccount(a);
      setChainId(Number(await w.provider.request({ method: "eth_chainId" })));
      setSession(loadSession(a));
      localStorage.setItem(LAST, w.rdns);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(undefined);
    }
  }, []);

  const signIn = useCallback(async () => {
    if (!wallet || !account) return;
    setError(undefined);
    setBusy("signing");
    try {
      const now = new Date();
      const issuedAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
      const message = signInMessage({ host: location.host, origin: location.origin, address: account, chainId: chainId ?? 1990, nonce, issuedAt, expiresAt });
      const signature = (await wallet.provider.request({ method: "personal_sign", params: [toHex(message), account] })) as Hex;
      if (!(await verifyMessage({ address: account, message, signature }))) throw new Error("The signature does not match this address.");
      const s: Session = { address: account, chainId: chainId ?? 1990, message, signature, issuedAt, expiresAt };
      localStorage.setItem(SESSION, JSON.stringify(s));
      setSession(s);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(undefined);
    }
  }, [wallet, account, chainId]);

  const switchTo = useCallback(
    async (id: number) => {
      if (!wallet) return;
      setError(undefined);
      setBusy("switching");
      const hex = `0x${id.toString(16)}`;
      try {
        await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
      } catch (e) {
        const code = (e as { code?: number }).code;
        const c = CHAINS[id];
        if ((code === 4902 || code === -32603) && c) {
          try {
            await wallet.provider.request({
              method: "wallet_addEthereumChain",
              params: [{ chainId: hex, chainName: c.name, nativeCurrency: { name: "QIE", symbol: "QIEV3", decimals: 18 }, rpcUrls: c.rpcUrls, ...(c.explorer ? { blockExplorerUrls: [c.explorer] } : {}) }],
            });
          } catch (e2) {
            setError(errText(e2));
          }
        } else setError(errText(e));
      } finally {
        try {
          setChainId(Number(await wallet.provider.request({ method: "eth_chainId" })));
        } catch {
          /* ignore */
        }
        setBusy(undefined);
      }
    },
    [wallet],
  );

  const disconnect = useCallback(() => {
    localStorage.removeItem(LAST);
    localStorage.removeItem(SESSION);
    // wallets that support it forget the site's permission too
    wallet?.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => undefined);
    setWallet(undefined);
    setAccount(undefined);
    setChainId(undefined);
    setSession(undefined);
    setError(undefined);
  }, [wallet]);

  const value = useMemo<WalletCtx>(
    () => ({
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
        setSheetOpen(true);
      },
      closeSheet: () => setSheetOpen(false),
      connect,
      signIn,
      switchTo,
      disconnect,
    }),
    [wallets, ready, wallet, account, chainId, session, busy, error, sheetOpen, connect, signIn, switchTo, disconnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet needs <WalletProvider>");
  return c;
}
