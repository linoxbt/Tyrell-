---
title: CLI Reference
description: Every tyrell command and subcommand, with its options, defaults, required keys and exit codes.
---

The `tyrell` CLI runs every Tyrell process and the human's commands. From the repository root, run it as `pnpm tyrell <command>`. Output is JSON unless noted; errors print `error: <message>` and set a non-zero exit code.

Each command runs as one process and loads only the keys it is allowed (see [Architecture](/docs/get-started/architecture#processes-and-keys)). Commands that talk to control need `tyrell control start` running.

## Summary

| Command | Keys | Needs control |
| --- | --- | --- |
| [`setup`](#tyrell-setup) | writes all keys; owner, in QIE Wallet | No |
| [`setup keys`](#tyrell-setup-keys) | writes all keys | No |
| [`setup register`](#tyrell-setup-register) | owner, in QIE Wallet | No |
| [`deploy`](#tyrell-deploy) | Foundry deployer | No |
| [`probe`](#tyrell-probe) | none | No |
| [`keys migrate`](#tyrell-keys-migrate) | every role's passphrase | No |
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
| [`agents …`](#tyrell-agents) | owner, in QIE Wallet (`consent`, `register`: agent) | No |
| [`network …`](#tyrell-network) | owner, in QIE Wallet (`message`: agent; `deploy`: Foundry deployer) | No |

Global options: `--version` prints `0.1.0`; `--help` works on every command.

## Setup and deployment

### tyrell setup

```sh
tyrell setup [--network <name>] [--store <kind>] [--gateway <url>] [--new-passphrase] [--daily-cap <units>] [--mint <units>] [--port <port>]
```

Runs both setup steps: `setup keys`, then, once a deployment exists for the chain, `setup register`. Before you have deployed, it stops after the keys and prints the next step (fund the submitter, `tyrell deploy`, then `tyrell setup` again). It takes the options of both subcommands. The subcommands below run each step on its own.

### tyrell setup keys

Generates one encrypted keystore per role (`user`, `agent`, `wallet`, `control`, `submitter`, `signer`, `data`) and writes `config.json`.

| Option | Default | Meaning |
| --- | --- | --- |
| `--network <name>` | `testnet` | `mainnet`, `testnet` or `local` |
| `--chain-id <id>` | 1990 / 1983 / 31337 by network | Override the chain id (local only) |
| `--store <kind>` | `dir` | `dir` (a local blob directory) or `pinata` |
| `--gateway <url>` | none | Pinata dedicated gateway |
| `--new-passphrase` | off | Create random passphrases where none exist: one per role in `TYRELL_HOME/pass.d/<role>` on testnet and mainnet, or the single shared `TYRELL_HOME/pass` on a local chain (mode 600) |

On testnet and mainnet each role needs its own passphrase (see [Configuration](/docs/reference/configuration#key-variables)): without `--new-passphrase`, write them to `pass.d/<role>` first, or the command refuses the shared file. It also refuses `TYRELL_SCRYPT_N` below 2^14 outside a local chain.

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
| `--token <address>` | No | Payment token. On mainnet it defaults to QUSDC and any other token is refused; unset on another chain deploys `TyrellTestUSD` |
| `--verify` | No | Verify sources on the QIE explorer (Blockscout) |

Writes `contracts/deployments/<chainId>.json` and copies it to `TYRELL_HOME/deployment-<chainId>.json`.

### tyrell probe

Re-runs the QIE network probe (`scripts/probe.ts`: RPCs, log windows, fees, EVM version, explorer, QIE MCP, IPFS) and prints the report; the same as `pnpm probe`. See `PROBE.md` and the [probe variables](/docs/reference/configuration#probe-variables).

### tyrell keys migrate

Adds the role MAC (`tyrell.mac`) to keystores written by an older Tyrell, which are otherwise refused. It opens each role's key with that role's passphrase, so run it as a user who can read them all, once, before splitting the files across OS users. Prints `migrated` or `already bound` per role.

## Processes

### tyrell control start

Starts control: verifies, encrypts, pins and anchors envelopes; computes the projection; evaluates payments; serves `control.sock` and the read-only web API on `127.0.0.1:${TYRELL_API_PORT:-7878}`.

The web API answers only `GET /api/view`, only with a loopback `Host` header (`127.0.0.1`, `localhost` or `[::1]`; anything else gets 421) and only with `Authorization: Bearer <token>` (401 otherwise). The token is `TYRELL_API_TOKEN`, or the contents of `TYRELL_HOME/api-token`, created with a random value on first start; control prints where it is.

| Option | Default | Meaning |
| --- | --- | --- |
| `--refresh-ms <ms>` | `15000` | Projection refresh interval |

Refuses to start unless each lane has exactly one active key. Stops cleanly on SIGINT or SIGTERM.

### tyrell signer start

Starts the vault signer on `signer.sock`. It pays only requests signed by the active control key, for a decision id never paid before, before the request's deadline (60 seconds after control signs it), that simulate cleanly. It answers with the transaction hash as soon as the transaction is broadcast; control waits for the receipt. No options.

### tyrell steward

```sh
tyrell steward "<task>"
```

Runs one Steward turn in a process that holds only the agent key. Requires `FORTYTWO_API_KEY`, or `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`. Prints `turn`, `readSet`, `writes`, `decisions` and `final`. See [Steward agent](/docs/guides/steward-agent).

A turn reads at most 64 memories (a decision record cites at most 64 parents), makes at most 6 tool calls per model reply and at most 3 payment proposals. Each proposal is signed with the agent key; control refuses unsigned or replayed ones.

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
tyrell release <seedId> --reason "<why>"
```

Releases a quarantine seed with a user-lane signature. The reason is recorded first as your own statement (a trusted user-lane memory, `Released quarantine seed <id>: <why>`), and that memory's CID goes on-chain with the release.

| Option | Required | Meaning |
| --- | --- | --- |
| `--reason <text>` | One of the two | Why the seed is released |
| `--reason-cid <cid>` | | An existing IPFS CID for the reason, instead of `--reason` |

Prints the release transaction, `reasonCid` and, with `--reason`, `reasonMemory`.

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
tyrell blast <seedId> [--mermaid] [--open]
```

Prints the blast radius of a seed as JSON, or as a Mermaid graph with `--mermaid`, and the console link for it on stderr: `<console>/console?tab=blast&seed=<seedId>`, where `<console>` is `TYRELL_CONSOLE_URL` (default `http://localhost:3000`).

| Option | Meaning |
| --- | --- |
| `--mermaid` | Print a Mermaid graph instead of JSON |
| `--open` | Open the console's blast-radius view in the browser |

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

Prints, from control: `head`, `digest`, `memories`, `classes`, `quarantined`, the `vault` balance and token, the number of `incidents`, `network`, `chainId`, `contracts`, `laneKeys`, the `submitter` address and its gas balance, and `activeSeeds`. When the submitter has less than `TYRELL_LOW_GAS` QIEV3 (default 0.05) it adds a `warnings` entry: top it up before anchoring stops.

### tyrell show

```sh
tyrell show <memoryId> [--forensic]
```

Prints one memory's envelope, verification result, class and lineage. `--forensic` also shows excluded (quarantined or unverified) memories.

### tyrell snapshot

Writes control's view document to a file, for the web console's read-only mode. Memory contents are left out by default: memory bodies, the reason the model gave with each payment proposal, incident summaries and the AI judge's reasons are removed (the document gets `"redacted": true`), so a snapshot can be published without exposing what the agent remembers.

| Option | Required | Meaning |
| --- | --- | --- |
| `--out <file>` | Yes | For example `apps/web/public/snapshot.json` |
| `--include-bodies` | No | Keep memory bodies, decision reasons and incident summaries in plain text. Only for demo data you mean to publish |

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

Compares the live digest with a fresh rebuild at the same head. Control computes the live digest at that head without touching its live state, so verifying never rewinds the console or recall.

| Option | Required | Meaning |
| --- | --- | --- |
| `--head <block>` | Yes | Block to compare at |

Prints `head`, `live`, `rebuilt`, `match`, `firstDifference` and `rebuildMs`. Exits with code 2 on a mismatch.

### tyrell store-check

Pins and fetches a test blob through the configured store and prints the CID and round-trip time.

## Agents network

Commands for the [agents network](/docs/agents/overview). Every write is an **owner transaction**: the CLI serves a local page on `127.0.0.1`, you approve each transaction in QIE Wallet, and the CLI then finds each one on-chain (by sender, target and calldata) and checks its receipt. It stops at the first revert with a plain error, and gives up after `TYRELL_OWNER_TIMEOUT` seconds (default 600) if the wallet never sends, instead of hanging. Every write accepts `--port <port>` (default `0`, any free port). Amounts are in token units, converted with the deployment's token decimals. See [Deploy and CLI](/docs/agents/deploy-and-cli) for the order to run them in.

### tyrell agents

| Command | Options | What it does |
| --- | --- | --- |
| `agents list` | | Your QIE ID binding, quota and every agent you registered, with key, token, live status, limits, today's spend, bond (what counts; `pendingWithdrawal` when a withdrawal is waiting) and reputation (a fixed number of reads) |
| `agents bind <qieId>` | | Bind your owner account to your QIE ID. On mainnet the name is resolved through the QIE MCP server first; on a test store a `claim` is sent first |
| `agents consent <human>` | `--ttl <seconds>` (86400) | Sign, with this deployment's agent key, its consent to be `<human>`'s agent. Prints `{ human, key, deadline, signature }` to give to that human |
| `agents register` | `--label <label>` (required), `--per-tx <amount>` (required), `--daily <amount>` (required), `--key <address>`, `--key-sig <hex>`, `--sig-deadline <unix>`, `--perms <list>` (`pay,memory`), `--any-payee`, `--model <text>` | Register an agent spending the deployment's token. Without `--key`, this deployment's agent-lane key, whose consent the CLI signs; then it checks the new id is yours with that key and records `agentId`. Another deployment's key needs `--key-sig` and `--sig-deadline` from its `agents consent`, checked locally first |
| `agents link-vault` | | `setSpender(vault)`, `GuardedVault.setAgentRegistry` (the vault then pays only via `payForAgent`), `MemoryAnchor.linkAgent` (agent memories need the memory permission), and `setSpender(network)` when linked to a network. Needs `agentId` |
| `agents quota <daily>` | | Your daily quota for the deployment's token, shared by all your agents |
| `agents limits <agentId> <perTx> <daily>` | | An agent's per-payment and daily limits |
| `agents perms <agentId> <list>` | | Permissions: `pay`, `memory`, `message`, `deal` |
| `agents payees <agentId> <labels>` | `--remove` | Delegate (or withdraw) comma-separated payee labels; `#N` is agent N as a deal counterparty |
| `agents any-payee <agentId> on\|off` | | Allow any registered payee, or only delegated ones |
| `agents revoke <agentId>` | `--reason <text>` (`revoked by its human`) | Revoke one agent for good |
| `agents rotate-consent <agentId> <human>` | `--ttl <seconds>` (86400) | Sign, with this deployment's agent-lane key, its consent to become agent `<agentId>`'s key for `<human>`. Prints `{ agentId, human, key, deadline, signature }` |
| `agents rotate-key [agentId]` | `--key <address>`, `--key-sig <hex>`, `--sig-deadline <unix>` | Replace an agent's key in place (`rotateAgentKey`). Default: this deployment's agent and its current agent-lane key, whose consent the CLI signs; another deployment's key needs the output of its `agents rotate-consent`. Waits until the registry shows the new key. On a linked deployment `revoke --lane agent --rotate` does this in the same owner page |
| `agents freeze` / `agents unfreeze` | | Stop or restart all of your agents |

### tyrell network

| Command | Options | What it does |
| --- | --- | --- |
| `network deploy` | `--arbiter <address>` (required), `--admin <address>` (required on mainnet; default the arbiter), `--bond-token <address>` (default the deployment's token), `--account <name>`, `--unlocked-sender <address>` (local only) | Run `DeployNetwork.s.sol` once per chain; writes `contracts/deployments/network-<chainId>.json`. Verifies on the explorer off local chains |
| `network link [file]` | | Record the network's addresses in your deployment file (default `contracts/deployments/network-<chainId>.json`) |
| `network bond <agentId> <amount>` | | Approve and post bond |
| `network request-withdrawal <agentId> <amount>` | | Step 1 of taking bond out; ready one contest window later |
| `network withdraw <agentId>` | | Step 2: withdraw the requested bond (never with open reports) |
| `network cancel-withdrawal <agentId>` | | Keep the bond after all |
| `network report <agentId>` | `--evidence <ref>` (required), `--category <n>` (`1`) | Approve and file a report (categories: 1 payment manipulation, 2 impersonation, 3 spam, 4 non-delivery, 5 other) |
| `network contest <reportId>` | | Approve and contest a report against your agent |
| `network finalize <reportId>` | | Close an uncontested report after the window: the reporter's bond back, no penalty |
| `network lapse <reportId>` | | Close a contested report the arbiter did not rule on in time: both bonds back |
| `network resolve <reportId>` | `--uphold` | Arbiter only: decide a contested report (default: dismiss) |
| `network appeal <agentId>` | `--evidence <ref>` (required) | Ask the arbiter to lift your agent's ban |
| `network unban <agentId>` | `--reason <text>` (required) | Arbiter only: lift a ban |
| `network set-arbiter <address>` | | Network owner (council) only: replace the arbiter |
| `network deal-open <fromAgent> <toAgent> <amount>` | `--terms <text>` (required), `--days <n>` (`3`) | Approve and escrow a deal |
| `network deal <action> <dealId>` | | Payer: `confirm`, `dispute`, `reclaim`. Payee: `deliver`, `cancel`, `claim`. Anyone: `lapse` |
| `network resolve-deal <dealId>` | `--pay-payee` | Arbiter only: decide a disputed deal (default: refund the payer) |
| `network rep <agentId>` | | Status, reputation, bond, pending withdrawal and record |
| `network message <toAgent> <text>` | `--ttl <seconds>` (`3600`) | Sign a message with this deployment's agent key; prints the JSON to send |
| `network verify <json>` | `--accept` | Verify a received message on-chain (a file path or inline JSON); `--accept` records it with `acceptMessage` so it can't be replayed |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Any error |
| 2 | `verify`: digests differ |
| 3 | `attack run`: at least one variant failed |
| 4 | `check caps`: worst-case daily loss exceeds `--max` |
