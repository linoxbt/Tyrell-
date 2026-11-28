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
| `pass.d/<role>` | `setup keys --new-passphrase` on testnet and mainnet | One keystore passphrase per role (mode 600) |
| `pass` | `setup keys --new-passphrase` on a local chain | One shared passphrase, accepted on a local test chain only (mode 600) |
| `keys/<role>.json` | `setup keys` | Encrypted keystore per role: `user`, `agent`, `wallet`, `control`, `submitter`, `signer`, `data` (mode 600) |
| `keys/addresses.json` | `setup keys`, `revoke --rotate` | Public addresses only |
| `keys/<role>.next.json` | `revoke --rotate` | The next key during a rotation |
| `keys/retired/` | `revoke --rotate` | Retired key files |
| `keys/attacker.json` | `attack run` | The attack set's attacker key |
| `api-token` | `control start` (first start) | Bearer token for control's read-only view API (mode 600) |
| `deployment-<chainId>.json` | `deploy` | Contract addresses, start block, owner, account id, token |
| `projection.sqlite` | `control start`, `rebuild` | Projection cache, recall index, incidents |
| `blobs/` | `control start` with `--store dir` | Sealed blobs |
| `control.sock`, `signer.sock` | `control start`, `signer start` | Unix sockets (mode 600, or `TYRELL_SOCKET_MODE`) |
| `ingest-state.json` | `ingest` | Last scanned block, saved after every window |
| `blocklist.json` | You | JSON array of addresses to block |
| `evidence.json` | `drill signer-leak` | Evidence transactions |

Every passphrase, key and token file must be private to its owner: a process refuses one that its group or other users can read (`chmod 600 <file>`).

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

`store` is `{ "kind": "dir", "dir": "<path>" }` or `{ "kind": "pinata", "gateway"?: "<url>" }`.

`rpcs` drives the cross-check (rule R0). The first two endpoints are each read on their own and must agree on everything; on testnet and mainnet they must be two different URLs, or the check proves nothing and every process refuses to start. Any further endpoints form a third client (viem `fallback()` across them) that breaks a tie when the first two disagree. With fewer than two endpoints, R0 blocks every payment.

## Core variables

| Variable | Default | Used by | Meaning |
| --- | --- | --- | --- |
| `TYRELL_HOME` | `~/.tyrell` | All | Home directory for keys, config and state |
| `TYRELL_DB` | `TYRELL_HOME/projection.sqlite` | Control, rebuild | Projection database path |
| `QIE_RPC_URLS` | the network's defaults | `setup keys` | Comma-separated RPC list written into a new `config.json` |
| `PINATA_JWT` | none | Control, rebuild | Required for the Pinata store. Never commit it |
| `QIE_MCP_URL` | `https://mcp.qie.digital/mcp` | `payee add`, ingest | QIE MCP server |
| `QIE_ID_NETWORK` | `mainnet` | `payee add` | Where QIE ID names are looked up: `mainnet` or `testnet`. Names exist only on mainnet, so testnet and local deployments look them up there too |
| `TYRELL_REPO` | the repository root | `deploy`, `attack run`, `network deploy` | Where the `contracts/` folder is |
| `TYRELL_OWNER_TIMEOUT` | `600` | Owner-transaction pages | Seconds to wait for the wallet to send each transaction before giving up |

## Key variables

Each role's key is opened with that role's own passphrase (invariant I-12). For role `R` (for example `CONTROL`), the first of these that exists wins:

1. the file named by `KEYSTORE_PASSPHRASE_FILE_R`;
2. `TYRELL_HOME/pass.d/<r>` (for example `pass.d/control`);
3. the shared file, `KEYSTORE_PASSPHRASE_FILE` or `TYRELL_HOME/pass`.

The shared file is accepted on a local test chain only. On testnet and mainnet a process refuses to open a key with it, because with one passphrase any process that can read another role's key file can decrypt it.

| Variable | Default | Meaning |
| --- | --- | --- |
| `KEYSTORE_PASSPHRASE_FILE_<ROLE>` | unset | Passphrase file for one role: `USER`, `AGENT`, `WALLET`, `CONTROL`, `SUBMITTER`, `SIGNER`, `DATA` |
| `KEYSTORE_PASSPHRASE_FILE` | `TYRELL_HOME/pass` | The shared passphrase file (local chains only) |
| `TYRELL_STRICT_KEYS` | unset | `1`: abort on a local chain too when a process can open another role's key. On testnet and mainnet this is always on |
| `TYRELL_INSECURE_SHARED_KEYS` | unset | `1`: the explicit, unsafe override that accepts the shared passphrase and cross-role key access on testnet and mainnet (a single-user machine only) |
| `TYRELL_SCRYPT_N` | `32768` (2^15) | scrypt cost for new keystores. `setup keys` refuses less than 16384 (2^14) outside a local chain |

A process "can open" another role's key when it can read both that key file and its passphrase file. Run each process as its own OS user, with its own passphrase file, to pass the check.

Keystores are Web3 Secret Storage files (version 3) with a second MAC that binds the role tag (`tyrell.mac`), so a file relabelled for another role fails to open. Files written by an older Tyrell lack it and are refused until you run `tyrell keys migrate`. A keystore that asks for more than n = 2^18, r = 16, p = 4 or 256 MB of scrypt memory is refused before any work is done.

## Control variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `TYRELL_API_PORT` | `7878` | Port of the read-only view API on `127.0.0.1`; `0` disables it |
| `TYRELL_API_HOSTS` | none | Extra `Host` names the view API accepts besides `127.0.0.1`, `localhost` and `[::1]` (comma-separated, exact), for a tunnel in front of it. It still listens on `127.0.0.1` only and still needs the token |
| `TYRELL_API_TOKEN` | the contents of `TYRELL_HOME/api-token` | Bearer token the view API requires (`Authorization: Bearer <token>`). The file is created with a random token, mode 600, on first start |
| `TYRELL_SOCKET_MODE` | `600` | Octal mode of `control.sock`. With one OS user per process, use `660` and a shared group; any permission for other users is refused |
| `TYRELL_LOW_GAS` | `0.05` | `tyrell status` warns when the submitter has less than this much QIEV3 for gas |
| `TYRELL_CONSOLE_URL` | `http://localhost:3000` | Console base URL that `tyrell blast` prints and opens |

## Model variables

| Variable | Default | Used by | Meaning |
| --- | --- | --- | --- |
| `FORTYTWO_API_KEY` | none | Steward, ingest | Fortytwo key: selects Qwen on Fortytwo when `LLM_BASE_URL` is unset |
| `LLM_PROVIDER` | auto | Steward | `fortytwo` to use Fortytwo with `LLM_API_KEY` |
| `LLM_BASE_URL` | Fortytwo's, with a Fortytwo key | Steward | OpenAI-compatible endpoint |
| `LLM_API_KEY` | `FORTYTWO_API_KEY` | Steward | API key. Sent only to the agent's own endpoint |
| `LLM_MODEL` | `qwen/qwen3.8-27b` on Fortytwo | Steward | Model name |
| `LLM_REASONING_EFFORT` | `low` on Fortytwo | Steward | Sent as `reasoning_effort` |
| `SENTINEL_LLM_BASE_URL` | `LLM_BASE_URL` | Ingest | Endpoint for the AI judge |
| `SENTINEL_LLM_API_KEY` | `FORTYTWO_API_KEY`, then `LLM_API_KEY` | Ingest | Key for the AI judge. Without it, the judge borrows the agent's key only for the agent's own host (or `FORTYTWO_API_KEY` only for Fortytwo); a judge on another host needs its own key |
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
| `SENTINEL_WINDOW` | `5000` | Blocks per scan window; the scan position is saved after each window |
| `TYRELL_WATCH` | none | Extra comma-separated addresses to watch besides the vault |
| `TYRELL_BLOCKLIST` | `TYRELL_HOME/blocklist.json` | Blocklist file |
| `AUTO_QUARANTINE_BLOCKLIST` | `true` | Seed a quarantine automatically on a blocklist hit (the address that matched, once; skipped if an active seed already covers it) |

Each scan reads at most 200 transfer events (the rest are summarised in one observation), merges identical dust transfers into one observation, and fetches token metadata four at a time. An event that cannot be decoded becomes an "undecodable event" observation instead of stopping the scan.

## Web app variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `TYRELL_API_URL` | unset | Control's read-only view API, for live mode, for example `http://127.0.0.1:7878`. Server-side only |
| `TYRELL_API_TOKEN` | unset | Sent as `Authorization: Bearer <token>` to `TYRELL_API_URL`. Control refuses requests without it |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | unset | Reown project id; enables Reown AppKit. Without it the site uses plain browser wallets (EIP-6963). Inlined at build time |
| `NEXT_PUBLIC_WALLET_MODE` | by project id | `reown` forces AppKit (browser wallets only, no relay, when there is no project id); `injected` forces plain browser wallets |
| `FORTYTWO_API_KEY` | unset | The playground's live AI demo (also any `LLM_*` settings). Without it the demo replays recorded runs. Set a spend limit on the key |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | unset | Optional: a shared rate limit for the AI demo across server instances (Vercel KV or Upstash Redis REST API). `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work |
| `TYRELL_SITE_URL` | `https://` + `VERCEL_PROJECT_PRODUCTION_URL`, else `https://tyrell-mu.vercel.app` | Absolute URL for social cards and `llms.txt` |

`apps/web/.env.example` lists them with comments.

## Deploy script variables

`tyrell deploy` sets these for `contracts/script/Deploy.s.sol`; you only need them to run the script by hand:

| Variable | Meaning |
| --- | --- |
| `OWNER` | Your QIE Wallet address |
| `SUBMITTER` | Control's gas key (anchors) |
| `VAULT_SIGNER` | The vault signer key |
| `TYRELL_ACCT` | The 32-byte account id |
| `TOKEN` | Payment token. On QIE Mainnet (1990) it defaults to QUSDC (`0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`) and the script refuses any other token; unset on another chain deploys `TyrellTestUSD` |

There is no `CONTROL` variable any more: the vault lets whichever key is the active control-lane key pause it, read live from the `LaneRegistry`, so the control key needs no vault role and rotating it needs no vault change. (`tyrell deploy` still passes it; the script ignores it.)

The agents network has its own script, `contracts/script/DeployNetwork.s.sol` (`tyrell network deploy`): `BOND_TOKEN`, `ARBITER`, `ADMIN`, `QIE_ID`, `MIN_BOND`, `REPORT_BOND`, `CONTEST_WINDOW`, `RULE_WINDOW`, `SLASH_BPS`, `BAN_AFTER`. See [Deploy and CLI](/docs/agents/deploy-and-cli#1-deploy-the-network-once-per-chain).

## Probe variables

`pnpm probe` (or `tyrell probe`) re-runs the QIE network probe and rewrites `PROBE.md`. Optional:

| Variable | Meaning |
| --- | --- |
| `PINATA_JWT`, `PINATA_GATEWAY` | Run P-10 (pin and fetch a 4 KB blob) |
| `PROBE_QIE_ID` | A QIE ID to round-trip in P-6 |
| `QUSDC_ADDRESS` | Token to check in P-7; defaults to the reported QUSDC address |
| `QIE_MCP_URL` | QIE MCP server |

## Test-only variables

| Variable | Meaning |
| --- | --- |
| `TYRELL_SCRYPT_N` | Lower scrypt cost for keystores in tests on a local chain (see Key variables) |
| `ATTACK_TABLE_OUT` | Where the CLI test writes the attack table |
| `DEMO_SNAPSHOT_OUT` | Where the loop test writes the web snapshot and blast file for T-19 |
| `NEXT_DIST_DIR` | Alternate Next.js build directory (the wallet test builds a second variant) |
| `WEB_SCREENSHOT_DIR` | Where the web tests save screenshots, when set |

## Loading a .env file

Copy `.env.example` to `.env` at the repository root and fill it in. `pnpm tyrell …` loads it on every run (Node's `--env-file-if-exists`), and a variable already set in your shell wins over the file. Nothing else loads it: for `pnpm probe`, the tests, or a process you start another way, load it into your shell first:

```sh
set -a; . ./.env; set +a
pnpm probe
```
