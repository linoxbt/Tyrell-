import { defineChain, type Chain } from "viem";

// RPC lists as found by probe P-1 (see PROBE.md). "Full" endpoints are real nodes: they answer
// eth_feeHistory, eth_estimateGas and eth_call. The explorer's /api/eth-rpc is Blockscout's partial
// JSON-RPC proxy: fine for logs and blocks, never one of R0's two cross-checked endpoints.

/** QIE mainnet, chain ID 1990 (0x7c6): full-node RPCs. */
export const QIE_MAINNET_RPCS = [
  "https://rpc1mainnet.qie.digital",
  "https://rpc2mainnet.qie.digital",
  "https://rpc3mainnet.qie.digital",
  "https://rpc4mainnet.qie.digital",
  "https://rpc5mainnet.qie.digital",
] as const;

/** QIE testnet, chain ID 1983 (0x7bf): full-node RPCs. rpc1-3testnet did not answer on 2026-11-26. */
export const QIE_TESTNET_RPCS = [
  "https://rpc4testnet.qie.digital",
  "https://rpc5testnet.qie.digital",
  "https://rpc1testnet.qie.digital",
  "https://rpc2testnet.qie.digital",
  "https://rpc3testnet.qie.digital",
] as const;

/** Blockscout eth-rpc proxies: logs and block reads only. */
export const QIE_MAINNET_LOG_RPC = "https://mainnet.qie.digital/api/eth-rpc" as const;
export const QIE_TESTNET_LOG_RPC = "https://testnet.qie.digital/api/eth-rpc" as const;

export const qieMainnet: Chain = defineChain({
  id: 1990,
  name: "QIE Mainnet",
  nativeCurrency: { name: "QIE", symbol: "QIEV3", decimals: 18 },
  rpcUrls: { default: { http: [...QIE_MAINNET_RPCS] } },
  blockExplorers: { default: { name: "QIE Explorer", url: "https://mainnet.qie.digital" } },
});

export const qieTestnet: Chain = defineChain({
  id: 1983,
  name: "QIE Testnet",
  nativeCurrency: { name: "QIE", symbol: "QIEV3", decimals: 18 },
  rpcUrls: { default: { http: [...QIE_TESTNET_RPCS] } },
  blockExplorers: { default: { name: "QIE Testnet Explorer", url: "https://testnet.qie.digital" } },
  testnet: true,
});

export type NetworkName = "mainnet" | "testnet";

export const networks = {
  mainnet: { chain: qieMainnet, rpcs: QIE_MAINNET_RPCS, logRpc: QIE_MAINNET_LOG_RPC, explorer: "https://mainnet.qie.digital" },
  testnet: { chain: qieTestnet, rpcs: QIE_TESTNET_RPCS, logRpc: QIE_TESTNET_LOG_RPC, explorer: "https://testnet.qie.digital" },
} as const satisfies Record<NetworkName, { chain: Chain; rpcs: readonly string[]; logRpc: string; explorer: string }>;

/** Probe P-4: both networks run Shanghai (PUSH0 yes, Cancun opcodes no). Compile with evm_version = "shanghai". */
export const QIE_EVM_VERSION = "shanghai" as const;

/** Reported QUSDC address on mainnet. Unconfirmed until probe P-7 and the QIE team agree. */
export const QUSDC_MAINNET = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5" as const;

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const; // key-scan: allow

/** QIE Wallet's EIP-6963 reverse-DNS identifier. */
export const QIE_WALLET_RDNS = "me.qiewallet" as const;

export * from "./abi.js";
export * from "./readers.js";
