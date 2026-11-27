---
title: Configuration
description: Every environment variable, file and default that configures Tyrell's processes, CLI and web app.
---

Tyrell is configured with a few files in `TYRELL_HOME` and environment variables. Nothing secret ever goes in a committed file: keys are encrypted keystores, and API keys and JWTs are environment variables.

## Files in TYRELL_HOME

`TYRELL_HOME` defaults to `~/.tyrell`. Use a separate home per network, for example `~/.tyrell-testnet` and `~/.tyrell-mainnet`.

| Path | Written by | Contents |
| --- | --- | --- |
| `config.json` | `setup keys`, `deploy` | Network, RPC list, chain id, account id, blob store, deployment file path |
| `pass` | `setup keys --new-passphrase` | Keystore passphrase (mode 600) |
| `keys/<role>.json` | `setup keys` | Encrypted keystore per role: `user`, `agent`, `wallet`, `control`, `submitter`, `signer`, `data` |
| `keys/addresses.json` | `setup keys`, `revoke --rotate` | Public addresses only |
| `keys/<role>.next.json` | `revoke --rotate` | The next key during a rotation |
| `keys/retired/` | `revoke --rotate` | Retired key files |
| `keys/attacker.json` | `attack run` | The attack set's attacker key |
| `deployment-<chainId>.json` | `deploy` | Contract addresses, start block, owner, account id, token |
| `projection.sqlite` | `control start`, `rebuild` | Projection cache, recall index, incidents |
| `blobs/` | `control start` with `--store dir` | Sealed blobs |
| `control.sock`, `signer.sock` | `control start`, `signer start` | Unix sockets |
| `ingest-state.json` | `ingest` | Last scanned block |
| `blocklist.json` | You | JSON array of addresses to block |
| `evidence.json` | `drill signer-leak` | Evidence transactions |

### config.json

```json
{
  "network": "testnet",
  "chainId": 1983,
  "rpcs": ["https://rpc4testnet.qie.digital", "https://rpc5testnet.qie.digital", "…"],
  "acct": "0x…",
  "store": { "kind": "pinata", "gateway": "https://<you>.mypinata.cloud" },
  "deploymentFile": "/home/you/.tyrell/deployment-1983.json"
}
```

`store` is `{ "kind": "dir", "dir": "<path>" }` or `{ "kind": "pinata", "gateway"?: "<url>" }`. Keep at least two RPC endpoints: with only one, the cross-check cannot pass and rule R0 blocks every payment.

## Core variables

| Variable | Default | Used by | Meaning |
| --- | --- | --- | --- |
| `TYRELL_HOME` | `~/.tyrell` | All | Home directory for keys, config and state |
| `TYRELL_DB` | `TYRELL_HOME/projection.sqlite` | Control, rebuild | Projection database path |
| `KEYSTORE_PASSPHRASE_FILE` | `TYRELL_HOME/pass` | All | File holding the keystore passphrase (never logged) |
| `TYRELL_STRICT_KEYS` | unset | All | `1`: abort if a process can read another role's key file |
| `QIE_RPC_URLS` | the network's defaults | `setup keys` | Comma-separated RPC list written into a new `config.json` |
| `PINATA_JWT` | none | Control, rebuild | Required for the Pinata store. Never commit it |
| `TYRELL_API_PORT` | `7878` | Control | Port of the read-only web API on `127.0.0.1`; `0` disables it |
| `QIE_MCP_URL` | `https://mcp.qie.digital/mcp` | `payee add`, ingest | QIE MCP server |
| `TYRELL_REPO` | the repository root | `deploy`, `attack run` | Where the `contracts/` folder is |

## Model variables

| Variable | Default | Used by | Meaning |
| --- | --- | --- | --- |
| `FORTYTWO_API_KEY` | none | Steward, ingest | Fortytwo key: selects Qwen on Fortytwo when `LLM_BASE_URL` is unset |
| `LLM_PROVIDER` | auto | Steward | `fortytwo` to use Fortytwo with `LLM_API_KEY` |
| `LLM_BASE_URL` | Fortytwo's, with a Fortytwo key | Steward | OpenAI-compatible endpoint |
| `LLM_API_KEY` | `FORTYTWO_API_KEY` | Steward | API key |
| `LLM_MODEL` | `qwen/qwen3.8-27b` on Fortytwo | Steward | Model name |
| `LLM_REASONING_EFFORT` | `low` on Fortytwo | Steward | Sent as `reasoning_effort` |
| `SENTINEL_LLM_BASE_URL` | `LLM_BASE_URL` | Ingest | Endpoint for the AI judge |
| `SENTINEL_LLM_API_KEY` | `LLM_API_KEY` | Ingest | Key for the AI judge |
| `SENTINEL_LLM_MODEL` | `LLM_MODEL` | Ingest | Model for the AI judge |
| `SENTINEL_LLM_PROVIDER`, `SENTINEL_LLM_REASONING_EFFORT` | the agent's; effort `none` on Fortytwo | Ingest | Provider and reasoning effort for the AI judge |
| `SENTINEL_AI` | `auto` | Ingest | `off` disables the AI judge |
| `SENTINEL_AI_TIMEOUT_MS` | `15000` | Ingest | AI judge timeout |

## Sentinel variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `SENTINEL_THRESHOLD` | `60` | Minimum score for an incident |
| `SENTINEL_DUST` | `1000` | Transfers at or below this many base units are dust |
| `SENTINEL_POLL_MS` | `15000` | Default poll interval of `ingest start` |
| `TYRELL_WATCH` | none | Extra comma-separated addresses to watch besides the vault |
| `TYRELL_BLOCKLIST` | `TYRELL_HOME/blocklist.json` | Blocklist file |
| `AUTO_QUARANTINE_BLOCKLIST` | `true` | Seed a quarantine automatically on a blocklist hit |

## Web app variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `TYRELL_API_URL` | unset | Control's read-only API, for live mode, for example `http://127.0.0.1:7878`. Server-side only |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | unset | Reown project id; enables Reown AppKit. Inlined at build time |
| `TYRELL_SITE_URL` | Vercel production domain, else `http://localhost:3000` | Absolute URL for social cards |

`apps/web/.env.example` lists them with comments.

## Deploy script variables

`tyrell deploy` sets these for `contracts/script/Deploy.s.sol`; you only need them to run the script by hand:

| Variable | Meaning |
| --- | --- |
| `OWNER` | Your QIE Wallet address |
| `SUBMITTER` | Control's gas key (anchors) |
| `VAULT_SIGNER` | The vault signer key |
| `CONTROL` | The control lane key (may pause the vault) |
| `TYRELL_ACCT` | The 32-byte account id |
| `TOKEN` | Payment token; unset on a non-mainnet chain deploys `TyrellTestUSD` |

## Probe variables

`pnpm probe` re-runs the QIE network probe and rewrites `PROBE.md`. Optional:

| Variable | Meaning |
| --- | --- |
| `PINATA_JWT`, `PINATA_GATEWAY` | Run P-10 (pin and fetch a 4 KB blob) |
| `PROBE_QIE_ID` | A QIE ID to round-trip in P-6 |
| `QUSDC_ADDRESS` | Token to check in P-7; defaults to the reported QUSDC address |
| `QIE_MCP_URL` | QIE MCP server |

## Test-only variables

| Variable | Meaning |
| --- | --- |
| `TYRELL_SCRYPT_N` | Lower scrypt cost for keystores in tests (default 2^15) |
| `ATTACK_TABLE_OUT` | Where the CLI test writes the attack table |
| `DEMO_SNAPSHOT_OUT` | Where the loop test writes the web snapshot and blast file for T-19 |
| `NEXT_DIST_DIR` | Alternate Next.js build directory (the wallet test builds a second variant) |
