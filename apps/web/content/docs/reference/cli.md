---
title: CLI Reference
description: Every tyrell command and subcommand, with its options, defaults, required keys and exit codes.
---

The `tyrell` CLI runs every Tyrell process and the human's commands. From the repository root, run it as `pnpm tyrell <command>`. Output is JSON unless noted; errors print `error: <message>` and set a non-zero exit code.

Each command runs as one process and loads only the keys it is allowed (see [Architecture](/docs/get-started/architecture#processes-and-keys)). Commands that talk to control need `tyrell control start` running.

## Summary

| Command | Keys | Needs control |
| --- | --- | --- |
| [`import`](#tyrell-import) | writes all keys | No |
| [`setup keys`](#tyrell-setup-keys) | writes all keys | No |
| [`setup register`](#tyrell-setup-register) | owner, in QIE Wallet | No |
| [`deploy`](#tyrell-deploy) | Foundry deployer | No |
| [`control start`](#tyrell-control-start) | control, submitter, data | — |
| [`signer start`](#tyrell-signer-start) | signer | No |
| [`steward <task>`](#tyrell-steward) | agent | Yes |
| [`payee add`](#tyrell-payee-add) | user | Yes |
| [`payee list`](#tyrell-payee-list) | none | No |
| [`payee remove <label>`](#tyrell-payee-remove) | user | Yes |
| [`payee reinstate <label>`](#tyrell-payee-reinstate) | user | Yes |
| [`release <seedId>`](#tyrell-release) | user | Yes |
| [`ingest scan`](#tyrell-ingest-scan) | wallet | Yes |
| [`ingest start`](#tyrell-ingest-start) | wallet | Yes |
| [`incidents`](#tyrell-incidents) | none | Yes |
| [`quarantine`](#tyrell-quarantine) | control (in control) | Yes |
| [`blast <seedId>`](#tyrell-blast) | none | Yes |
| [`revoke`](#tyrell-revoke) | owner, in QIE Wallet | No |
| [`attack run`](#tyrell-attack-run) | attacker | Yes |
| [`check caps`](#tyrell-check-caps) | none | No |
| [`drill signer-leak`](#tyrell-drill-signer-leak) | signer | No |
| [`snapshot`](#tyrell-snapshot) | none | Yes |
| [`evidence`](#tyrell-evidence) | none | No |
| [`say <text>`](#tyrell-say) | user | Yes |
| [`status`](#tyrell-status) | none | Yes |
| [`show <memoryId>`](#tyrell-show) | none | Yes |
| [`rebuild`](#tyrell-rebuild) | data | No (refuses to replace the live database while control runs) |
| [`verify`](#tyrell-verify) | data | Yes |
| [`store-check`](#tyrell-store-check) | none | No |

Global options: `--version` prints `0.1.0`; `--help` works on every command.

## Setup and deployment

### tyrell import

```sh
pnpm tyrell import <account file>
```

Sets up `TYRELL_HOME` from the account file the [console](/console) downloads when it creates an account. Asks for the password chosen in the console (or reads `TYRELL_IMPORT_PASSWORD`), opens every key with it, checks each key's role tag and address, and refuses to overwrite existing keys. Writes `keys/<role>.json`, `keys/addresses.json`, `config.json`, `deployment-<chain>.json` and, if absent, the passphrase file.

### tyrell setup keys

Generates one encrypted keystore per role (`user`, `agent`, `wallet`, `control`, `submitter`, `signer`, `data`) and writes `config.json`.

| Option | Default | Meaning |
| --- | --- | --- |
| `--network <name>` | `testnet` | `mainnet`, `testnet` or `local` |
| `--chain-id <id>` | 1990 / 1983 / 31337 by network | Override the chain id (local only) |
| `--store <kind>` | `dir` | `dir` (a local blob directory) or `pinata` |
| `--gateway <url>` | none | Pinata dedicated gateway |
| `--new-passphrase` | off | Create `TYRELL_HOME/pass` with a random passphrase if no passphrase file exists |

Existing key files are kept. Prints every public address and the account id, then the next step: fund the submitter with a little QIEV3 and run `tyrell deploy`.

### tyrell setup register

Serves a local page that sends the missing owner transactions from QIE Wallet: lane keys not yet active, the vault's daily cap, and optionally test funds.

| Option | Default | Meaning |
| --- | --- | --- |
| `--daily-cap <units>` | `5000000` | Vault-wide daily cap in token base units |
| `--mint <units>` | none | Testnet `TyrellTestUSD` only: top the vault up to this many base units |
| `--port <port>` | `0` (random) | Local port for the page |

Prints the page URL and the transactions, then polls every 4 seconds and exits when nothing is pending. Fails if a lane already has a different active key (rotate it with `tyrell revoke --rotate`), or if `--mint` is used with a real token.

### tyrell deploy

Deploys the contracts with Foundry (`contracts/script/Deploy.s.sol`). Roles go to the keys from `setup keys`; the deployer holds nothing afterwards.

| Option | Required | Meaning |
| --- | --- | --- |
| `--owner <address>` | Yes | Your QIE Wallet address: owner of every contract and admin of the vault |
| `--account <name>` | One of `--account` or `--unlocked-sender` | Foundry keystore name of a funded throwaway deployer |
| `--unlocked-sender <address>` | | Local chains only: deploy from an unlocked node account |
| `--token <address>` | On mainnet | Payment token (QUSDC on mainnet). Unset on another chain deploys `TyrellTestUSD` |
| `--verify` | No | Verify sources on the QIE explorer (Blockscout) |

Writes `contracts/deployments/<chainId>.json` and copies it to `TYRELL_HOME/deployment-<chainId>.json`.

## Processes

### tyrell control start

Starts control: verifies, encrypts, pins and anchors envelopes; computes the projection; evaluates payments; serves `control.sock` and the read-only web API on `127.0.0.1:${TYRELL_API_PORT:-7878}`.

| Option | Default | Meaning |
| --- | --- | --- |
| `--refresh-ms <ms>` | `15000` | Projection refresh interval |

Refuses to start unless each lane has exactly one active key. Stops cleanly on SIGINT or SIGTERM.

### tyrell signer start

Starts the vault signer on `signer.sock`. It pays only requests signed by the active control key, for a decision id never paid before, that simulate cleanly. No options.

### tyrell steward

```sh
tyrell steward "<task>"
```

Runs one Steward turn in a process that holds only the agent key. Requires `FORTYTWO_API_KEY`, or `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`. Prints `turn`, `readSet`, `writes`, `decisions` and `final`. See [Steward agent](/docs/guides/steward-agent).

### tyrell ingest scan

One sentinel pass: new transfers, metadata and MCP reads, written through the wallet lane, then scored.

| Option | Default | Meaning |
| --- | --- | --- |
| `--from <block>` | after the last scan, or the deployment block | Start block |
| `--mcp` | off | Also read balances through the QIE MCP server |

Prints `from`, `to`, `observations` and `incidents`. Saves the last scanned block to `TYRELL_HOME/ingest-state.json`.

### tyrell ingest start

Runs `ingest scan` in a loop.

| Option | Default | Meaning |
| --- | --- | --- |
| `--poll-ms <ms>` | `SENTINEL_POLL_MS` or `15000` | Poll interval |
| `--mcp` | off | Also read balances through the QIE MCP server |

## Memory and payees

### tyrell say

```sh
tyrell say "<text>"
```

Writes a user-lane statement, signed with the user key in this process. This is the only way to create a `trusted` memory. Prints the memory id, CID, transaction hash and block.

### tyrell payee add

Adds a payee with a user-lane signature; control relays the transaction.

| Option | Required | Meaning |
| --- | --- | --- |
| `--label <label>` | Yes | For example `landlord`; 1–64 letters, digits, space, `_`, `.` or `-` |
| `--qie-id <id>` | One of `--qie-id` or `--address` | QIE ID, resolved once now and required to round-trip |
| `--address <0x>` | | Raw address instead of a QIE ID |
| `--token <address>` | No | Payee token; defaults to the vault token |
| `--cap <amount>` | Yes | Per-payment cap in token units |
| `--daily <amount>` | Yes | Daily cap in token units |
| `--confirm <last6>` | No | Last 6 characters of the address; prompted for if omitted |

Prints `payeeId`, `addr`, `capPerTx`, `capPerDay`, `txHash` and `block`. See [Payees](/docs/guides/payees).

### tyrell payee list

Prints every payee on the ledger at the latest block.

### tyrell payee remove

```sh
tyrell payee remove <label>
```

Deactivates a payee (user-lane signature).

### tyrell payee reinstate

```sh
tyrell payee reinstate <label>
```

Reactivates a payee and clears its suspension (user-lane signature).

### tyrell release

```sh
tyrell release <seedId> --reason <cid>
```

Releases a quarantine seed with a user-lane signature.

| Option | Required | Meaning |
| --- | --- | --- |
| `--reason <cid>` | Yes | IPFS CID of the reason |

## Detection and response

### tyrell incidents

Prints the sentinel incidents control has recorded.

### tyrell quarantine

Previews a seed's blast radius, asks for confirmation, then seeds the quarantine with the control key. Pass exactly one of the seed options.

| Option | Meaning |
| --- | --- |
| `--source <ref>` | Token contract, NFT contract, sender address or transaction hash |
| `--memory <id>` | One memory id |
| `--signer-window <spec>` | `<address>:<fromBlock>-<toBlock>` |
| `--turn <id>` | Every write from one Steward turn |
| `--reason <text>` | Required. Why; sealed and pinned, its CID goes on-chain |
| `--yes` | Do not ask for confirmation (required when stdin is not a terminal) |

Prints `seedId`, `txHash`, `reasonCid`, the preview and any suspended payees. See [Quarantine and blast radius](/docs/guides/quarantine-and-blast-radius).

### tyrell blast

```sh
tyrell blast <seedId> [--mermaid]
```

Prints the blast radius of a seed as JSON, or as a Mermaid graph with `--mermaid`.

### tyrell revoke

Revokes or rotates a lane key from QIE Wallet (owner). Serves a local page for the owner transaction.

| Option | Default | Meaning |
| --- | --- | --- |
| `--lane <role>` | required | `user`, `agent`, `wallet` or `control` |
| `--rotate` | off | Generate a new key (`keys/<role>.next.json`) and register it in the same transaction |
| `--reason <text>` | `suspected compromise` | Recorded on-chain |
| `--port <port>` | `0` (random) | Local port for the page |

After a rotation, the old key file moves to `keys/retired/` and `addresses.json` is updated; restart that lane's process.

## Checks and drills

### tyrell attack run

Runs the [attack set](/docs/guides/attack-set) against the configured deployment.

| Option | Meaning |
| --- | --- |
| `--variant <n>` | Run one variant (1–10) |
| `--markdown` | Print the result table as Markdown |

Exits with code 3 if any variant fails.

### tyrell check caps

Computes the worst-case daily loss: the minimum of the vault-wide daily cap, the sum of active payees' daily caps and the vault balance.

| Option | Default | Meaning |
| --- | --- | --- |
| `--max <units>` | `20` | The most you accept losing in a day, in token units |

Prints `vaultBalance`, `vaultDailyCap`, `payeeDailyCaps`, `worstCaseDailyLoss`, `limit` and `ok`. Exits with code 4 if not ok.

### tyrell drill signer-leak

The vault signer key sends `pay` for an unregistered payee directly, with a fixed gas limit so the transaction is broadcast and reverts on-chain. Records the transaction in `TYRELL_HOME/evidence.json`.

| Option | Default | Meaning |
| --- | --- | --- |
| `--amount <units>` | `1` | Amount in token units |

### tyrell evidence

Prints explorer links for the contracts and the latest `MemoryAnchored`, `QuarantineSeeded` and `Paid` transactions, plus the signer-leak drill's reverted transaction.

## Inspection

### tyrell status

Prints contracts, lane keys, head, digest, classes and seeds from control.

### tyrell show

```sh
tyrell show <memoryId> [--forensic]
```

Prints one memory's envelope, verification result, class and lineage. `--forensic` also shows excluded (quarantined or unverified) memories.

### tyrell snapshot

Writes control's view document to a file, for the web console's read-only mode.

| Option | Required | Meaning |
| --- | --- | --- |
| `--out <file>` | Yes | For example `apps/web/public/snapshot.json` |

## Rebuild and storage

### tyrell rebuild

Rebuilds the projection from QIE and IPFS alone and prints the digest and counts.

| Option | Required | Meaning |
| --- | --- | --- |
| `--fresh` | Yes | Delete the local database first |
| `--out <path>` | No | Write the rebuilt database here instead of the live path |
| `--head <block>` | No | Rebuild as of this block |

Refuses to replace the live database while control is running.

### tyrell verify

Compares the live digest with a fresh rebuild at the same head.

| Option | Required | Meaning |
| --- | --- | --- |
| `--head <block>` | Yes | Block to compare at |

Prints `head`, `live`, `rebuilt`, `match`, `firstDifference` and `rebuildMs`. Exits with code 2 on a mismatch.

### tyrell store-check

Pins and fetches a test blob through the configured store and prints the CID and round-trip time.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Any error |
| 2 | `verify`: digests differ |
| 3 | `attack run`: at least one variant failed |
| 4 | `check caps`: worst-case daily loss exceeds `--max` |
