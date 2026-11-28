---
title: Architecture
description: Tyrell's processes, keys, contracts, storage and data flow, and why each key lives in exactly one process.
---

Tyrell is five local processes, four contracts on QIE and an encrypted blob store. Each process holds only the keys it needs, so compromising one process gives an attacker one capability, not all of them.

## Overview

```text
  Lane processes, one key each                  QIE (chain 1990 / 1983)
  ┌──────────────────┐                          ┌────────────────────┐
  │ Human CLI        │──signed envelopes──┐     │ LaneRegistry       │◀─┐
  │ user key         │                    │     │ who signs each lane│  │ checks lane keys
  ├──────────────────┤                    ▼     ├────────────────────┤  │
  │ Ingest worker    │──signed──▶ ┌──────────┐ │ MemoryAnchor       │──┤
  │ wallet key       │            │ Control  │─▶│ anchors + CIDs     │  │
  ├──────────────────┤            │ control, │ ├────────────────────┤  │
  │ Steward agent    │──signed,──▶│ submitter│─▶│ TyrellLedger       │──┘
  │ agent key        │ proposals  │ data keys│ │ payees, seeds      │◀─┐
  └──────────────────┘            └────┬─────┘ ├────────────────────┤  │ checks payees,
                                       │       │ GuardedVault       │──┘ caps
                    ALLOW, signed by   │       │ holds the tokens   │
                    the control key    ▼       └────────────────────┘
                                  ┌─────────┐          ▲
                                  │ Signer  │──pay─────┘
                                  │ signer  │
                                  │ key     │       IPFS (Pinata or a local directory)
                                  └─────────┘       encrypted envelopes, pinned by control
```

## Processes and keys

`tyrell setup keys` generates seven keys, one encrypted keystore file each, under `TYRELL_HOME/keys/`. Each process may load only its own:

| Process | Command | Keys | Can | Cannot |
| --- | --- | --- | --- | --- |
| Human CLI | `tyrell say`, `tyrell payee …`, `tyrell release` | `user` | Write trusted statements, add/remove/reinstate payees, release quarantines | Anchor directly, pay |
| Steward | `tyrell steward "<task>"` | `agent` | Recall memories, write notes and summaries, propose payments | Write through another lane, sign a transaction, add a payee |
| Ingest worker | `tyrell ingest start` / `scan` | `wallet` | Write observations of external data, record incidents | Write trusted or derived memories |
| Control | `tyrell control start` | `control`, `submitter`, `data` | Verify, encrypt, pin, anchor; seed quarantines; decide payments; sign pay requests | Add payees, release quarantines, pay directly |
| Signer | `tyrell signer start` | `signer` | Call `GuardedVault.pay` for a request signed by the control key | Pay anyone the ledger does not allow |
| Owner | QIE Wallet in a browser | owner | Register, revoke and rotate lane keys; set the vault cap; pause, unpause, withdraw | — |

The `submitter` key pays gas for anchors, ledger relays and quarantine seeds; it is the only address `MemoryAnchor` accepts as a submitter. The `data` key is a 32-byte AES-256-GCM key, not an EVM key.

Each role's key has its own passphrase (`TYRELL_HOME/pass.d/<role>`), and each keystore carries a MAC that binds its role tag, so a key file relabelled for another role does not open.

> [!IMPORTANT]
> Key separation (invariant I-12) is fully enforced when each process runs as its own OS user that owns only its own key and passphrase files. Every process checks at startup which other roles' keys it could open (read both the key file and its passphrase). On testnet and mainnet that aborts the process; on a local test chain it warns, and `TYRELL_STRICT_KEYS=1` makes it abort there too.

## Inter-process communication

Processes talk over Unix domain sockets in `TYRELL_HOME` (mode 600, or `TYRELL_SOCKET_MODE`, for example `660` with a shared group when each process has its own OS user), using newline-delimited JSON validated with strict schemas:

| Socket | Server | Requests |
| --- | --- | --- |
| `control.sock` | Control | `submit`, `submitBatch`, `status`, `recall`, `show`, `refresh`, `propose`, `incident`, `incidents`, `quarantine`, `blast`, `view`, `ledger`, `digest` |
| `signer.sock` | Signer | One pay request: `payeeId`, `token`, `amount`, `decisionId`, `deadline` (and `agentId` on an agents-network deployment), with `controlSig` |

Socket permissions say who can connect; signatures say who is asking. The requests that make control act are signed by the caller's lane key, with a fresh nonce and an expiry two minutes ahead, and control refuses unsigned, wrongly signed, replayed or expired ones:

| Request | Must be signed by |
| --- | --- |
| `propose` (a payment proposal) | The agent key (Steward) |
| `incident` | The wallet key (ingest) |
| `quarantine` (not a preview) | The user key; the wallet key may only seed a source (the sentinel's automatic blocklist quarantine) |

Control also remembers every memory it served to a Steward turn through `recall` and adds them to that turn's payment decision, so a proposal cannot leave out what the model read.

The signer accepts a request only if `controlSig` recovers (EIP-191) to the active control lane key, its deadline (60 seconds) has not passed, the decision id has not been paid before, and the exact `pay` call simulates cleanly right now. It returns the transaction hash as soon as it broadcasts, and control waits for the receipt.

### Paying

Control writes a payment decision to the chain **before** it asks the signer to pay: the decision record (control lane, parents = everything the turn read) uses the same id the vault will see, and if it cannot be recorded, nothing is paid. A turn that read more than 64 memories, more than a record can cite, is blocked. After the payment, control records the outcome (`paid`, `failed` or `unknown`) as a second control-lane note whose parent is the decision.

If the signer's answer is lost, control reads the chain (`decisionUsed` and the vault's `Paid` events) until shortly after the request's deadline (the signer never broadcasts after it), and records what happened. While an allowed decision has no settled outcome, new payments to the same payee are blocked, so a lost answer can never become a second payment. Decision records are accepted only from the control lane: anything else claiming to be a decision is `unverified` (`DECISION_NOT_CONTROL`).

Control also serves a read-only HTTP API for the web console: `GET /api/view` on `127.0.0.1:7878` (`TYRELL_API_PORT`), bound to loopback only. It has no write endpoints, requires a bearer token (`TYRELL_HOME/api-token`), and refuses any `Host` header but `127.0.0.1`, `localhost` or `[::1]`, so a web page that rebinds its domain to your machine cannot read it.

## Contracts

| Contract | Role | Admin |
| --- | --- | --- |
| `LaneRegistry` | One active key per lane; history of every binding | Owner (`Ownable2Step`) |
| `MemoryAnchor` | Anchors memory struct hashes and CIDs after checking the lane signature on-chain | Owner sets the submitter |
| `TyrellLedger` | Payees and quarantine seeds; every write carries an EIP-712 signature from the right lane | None: no owner, no admin path |
| `GuardedVault` | Holds the payment token and pays registered payees within caps | Owner (`DEFAULT_ADMIN_ROLE`, never fewer than one admin); signer has `SIGNER_ROLE`; the owner and whichever key is the active control-lane key may pause |
| `TyrellTestUSD` | 6-decimal test token for testnet and local chains | Owner mints |

Every privileged role goes to your QIE Wallet address at construction, so the deployer key holds nothing afterwards. See [Core contracts](/docs/reference/contracts-core).

## Storage

| Store | What | Where |
| --- | --- | --- |
| IPFS | AES-256-GCM sealed envelopes (12-byte nonce, then ciphertext and tag), and sealed quarantine reasons | Pinata (`--store pinata`, needs `PINATA_JWT`) or a local directory (`--store dir`) |
| QIE | Lane bindings, anchors (struct hash, signer, lane, CID), payees, seeds, vault spend | The four contracts |
| SQLite | The projection cache, recall index and sentinel incidents | `TYRELL_HOME/projection.sqlite` (`TYRELL_DB` overrides) |
| Local files | Keystores (`keys/`), `config.json`, `deployment-<chainId>.json`, `ingest-state.json`, `blocklist.json`, `evidence.json` | `TYRELL_HOME` (default `~/.tyrell`) |

The SQLite database can always be thrown away and rebuilt from QIE and IPFS. Incidents are the exception: they are local detection hints and are not rebuilt from the chain.

### Encryption

Keystores use the Web3 Secret Storage format (version 3: scrypt, AES-128-CTR, keccak MAC), the same format Foundry uses, with scrypt cost 2^15 by default, plus a second MAC (`tyrell.mac`) over the role tag. Each role's passphrase is read from `KEYSTORE_PASSPHRASE_FILE_<ROLE>` or `TYRELL_HOME/pass.d/<role>`; the shared `TYRELL_HOME/pass` is accepted on a local test chain only. A keystore asking for excessive scrypt cost is refused before deriving.

Memory bodies are sealed with the data key. The account id and memory id are the additional authenticated data, so a blob cannot be replayed under another id, and the body hash and struct hash anchored on-chain catch any swapped bytes.

## The projection

On startup and every 15 seconds (`--refresh-ms`), control builds the projection:

1. Read lane key events, anchors and ledger state from QIE in 5,000-block windows, two confirmations behind the head, on two RPC endpoints independently, and compare everything: the head block hash, every field of every lane event and anchor in the whole history, and the full ledger state. The head hash is checked again after the reads, so a reorg mid-read is refused. If the two disagree, a third endpoint decides (the version two endpoints agree on wins); otherwise the refresh fails with `CHAIN_INCONSISTENT` and payments are blocked by R0. After the first full read, refreshes read only the new blocks, once both endpoints confirm the last cross-checked block is still canonical.
2. Fetch and decrypt each anchored blob, eight at a time.
3. Verify each memory (six steps, seventeen failure reasons).
4. Compute trust classes and quarantine flags in one topological pass.
5. Compute the projection digest.

Startup refuses to proceed unless each lane has exactly one active key. Refreshes run one at a time, and an older result never replaces a newer one. `tyrell verify` computes the digest at a past head without touching the live projection.

## Reading the chain

| Concern | Approach |
| --- | --- |
| Log range | 5,000-block windows (probe P-2) |
| Consistency | Two independent endpoints (different URLs on testnet and mainnet) must agree on the full history; a third breaks ties; the explorer's `/api/eth-rpc` proxy is never one of them |
| Freshness | Block reads use `cacheTime: 0`; lane processes may be up to two blocks ahead of control (`REF_BLOCK_SKEW`) |
| Time | "Today" is `block.timestamp / 86400` (UTC) in both the policy engine and the vault |

## The web app

The Next.js web app in `apps/web` has the landing page, the [console](/console), a [get-started](/start) flow, the [playground](/playground) and these docs. It reads one view document from `/api/view`, which proxies control's read-only API when `TYRELL_API_URL` is set and serves `public/snapshot.json` otherwise. See [Web console and wallet](/docs/guides/web-console-and-wallet).

## Beyond one agent

The core system binds one agent to one human. The [agents network](/docs/agents/overview) extends this to many agents under one human, each bound to the human's QIE ID, with shared quotas, bonds and reputation.
