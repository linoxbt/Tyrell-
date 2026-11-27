---
title: Networks
description: QIE Mainnet and Testnet chain IDs, RPC endpoints, explorers, block times, EVM version, tokens and the QIE MCP server, as probed.
---

Tyrell runs on QIE Mainnet and QIE Testnet. The values below come from `packages/chain/src/index.ts` and the Phase 0 network probe (`PROBE.md`, run 2026-11-26). Re-run the probe before a deployment:

```sh
pnpm probe
```

## Summary

| | QIE Mainnet | QIE Testnet |
| --- | --- | --- |
| Chain ID | `1990` (`0x7c6`) | `1983` (`0x7bf`) |
| Native currency | QIE (symbol `QIEV3`, 18 decimals) | QIE (symbol `QIEV3`, 18 decimals) |
| Explorer | `https://mainnet.qie.digital` | `https://testnet.qie.digital` |
| EVM version | Shanghai (PUSH0 yes, Cancun opcodes no) | Shanghai |
| Fees | EIP-1559 | EIP-1559 |
| Block time | about 3.6 s (min 3, max 4) | about 4.3 s (min 4, max 5) |
| Log window | 5,000 blocks | 5,000 blocks |
| QIE ID | Deployed | Not deployed |
| Payment token | QUSDC | `TyrellTestUSD` (deployed by `tyrell deploy`) |

## RPC endpoints

### Mainnet

| Endpoint | Status on 2026-11-26 |
| --- | --- |
| `https://rpc1mainnet.qie.digital` | Full node |
| `https://rpc2mainnet.qie.digital` | Full node |
| `https://rpc3mainnet.qie.digital` | Full node |
| `https://rpc4mainnet.qie.digital` | Full node |
| `https://rpc5mainnet.qie.digital` | Full node, fastest from the probe's location |
| `https://mainnet.qie.digital/api/eth-rpc` | Partial proxy (Blockscout): logs and block reads only |

### Testnet

| Endpoint | Status on 2026-11-26 |
| --- | --- |
| `https://rpc4testnet.qie.digital` | Full node |
| `https://rpc5testnet.qie.digital` | Full node |
| `https://rpc1testnet.qie.digital` | No answer (timeout) |
| `https://rpc2testnet.qie.digital` | No answer (timeout) |
| `https://rpc3testnet.qie.digital` | No answer |
| `https://testnet.qie.digital/api/eth-rpc` | Partial proxy (Blockscout): logs and block reads only |

Tyrell's defaults list the testnet endpoints that answered first. Override the list for a new `config.json` with `QIE_RPC_URLS`.

> [!IMPORTANT]
> Rule R0 needs **two** full-node endpoints that agree. The explorer's `/api/eth-rpc` proxy is never one of them: it lacks `eth_feeHistory` and rejects `eth_estimateGas` parameters.

### Method support

| Method | Mainnet | Testnet |
| --- | --- | --- |
| `eth_call` | Yes | Yes |
| State overrides in `eth_call` | No | No |
| `eth_simulateV1` | No | No |
| `eth_estimateGas` | Yes | Yes |
| `eth_getLogs` over 5,000 blocks | Yes | Yes |

Because state overrides and `eth_simulateV1` are unavailable, rule R5 simulates `GuardedVault.pay` with a plain `eth_call` from the signer's address.

## Confirmations

Control reads the chain two confirmations behind the head (about 6 to 9 seconds), so an anchor is treated as final shortly after it is mined. The sentinel's default 15-second poll covers about four mainnet blocks.

## Gas price

The probe saw `eth_gasPrice` at 1.125 gwei on mainnet (base fee 1 gwei, priority fee 0.125 gwei). At that price, deploying all five contracts (6,554,091 gas) costs about 0.0074 QIEV3, and anchoring one memory (up to 93,198 gas) about 0.0001 QIEV3.

## Contract verification

| Network | Command |
| --- | --- |
| Mainnet | `forge verify-contract --verifier blockscout --verifier-url https://mainnet.qie.digital/api/` |
| Testnet | `forge verify-contract --verifier blockscout --verifier-url https://testnet.qie.digital/api/` |

`tyrell deploy --verify` passes these for you. Fallback: the explorer's web form with flattened sources, compiler 0.8.28, optimizer 200 runs, EVM version `shanghai`.

## Tokens

| Token | Address | Decimals | Notes |
| --- | --- | --- | --- |
| QUSDC (mainnet) | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` | 6 | Matches the reported address on-chain and is in the QIE MCP token list (`qie_list_tokens`). Confirm with QIE before funding |
| `TyrellTestUSD` (`tUSD`) | Deployed per testnet/local deployment | 6 | Worthless test token; the owner mints it |

## QIE MCP server

`https://mcp.qie.digital/mcp` (override with `QIE_MCP_URL`). Tyrell uses:

| Tool | Used for |
| --- | --- |
| `qie_resolve_name` | Resolving a payee's QIE ID at registration (mainnet) |
| `qie_reverse_lookup` | The required reverse round-trip for a payee's QIE ID |
| `qie_get_balances` | Balance reads by the ingest worker with `--mcp`, written as untrusted observations |

The server also offers `qie_get_tx_status`, `qie_list_tokens` and `qie_get_network_info`. QIE ID lookups on testnet return `unresolved` because QIE ID is not deployed there.

## QIE Wallet

QIE Wallet announces itself over EIP-6963 with rdns `me.qiewallet`. Tyrell's owner pages and web app discover it by that identifier, switch it to the right chain (adding the network if needed) and ask it to sign. The web app links to `https://www.qiewallet.me` when it is not installed.

## Testnet faucet

`https://qie.digital/faucet`.

## Local chains

For development, `tyrell setup keys --network local` targets `http://127.0.0.1:8545` (anvil, chain id 31337 unless `--chain-id` is given), and `tyrell deploy --unlocked-sender <address>` deploys from an unlocked anvil account.
