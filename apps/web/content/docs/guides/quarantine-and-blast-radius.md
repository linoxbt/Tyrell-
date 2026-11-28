---
title: Quarantine and Blast Radius
description: Preview what a poisoned source reached, seed an on-chain quarantine that excludes it and its descendants, and release it with the user key.
---

When a source turns out to be poisoned, Tyrell answers two questions: *what did it reach?* (the blast radius) and *how do I get a clean state back?* (quarantine). Neither deletes anything.

## Seed types

A quarantine seed is a record on `TyrellLedger`, signed by the control lane key.

| Type | CLI flag | Seed value on-chain | Excludes |
| --- | --- | --- | --- |
| `memory` (1) | `--memory <id>` | The 16-byte id, right-padded to 32 bytes | One memory and its descendants |
| `source` (2) | `--source <ref>` | An address left-padded to 32 bytes, or a 32-byte transaction hash | Every memory whose `src` names that token contract, NFT contract, sender or transaction, and their descendants |
| `signer-window` (3) | `--signer-window <address>:<from>-<to>` | The signer address, with `fromBlock` and `toBlock` | Every memory signed by that key and anchored in that block range, and their descendants |
| `turn` (4) | `--turn <id>` | The turn id, right-padded | Every write from one Steward turn, and their descendants |

`fromBlock` and `toBlock` must be zero for every type except `signer-window`, where `fromBlock <= toBlock`.

## Preview the blast radius

`tyrell quarantine` always previews first:

```sh
pnpm tyrell quarantine --source 0xPoisonToken… --reason "token name tells the agent the landlord moved"
```

```text
Preview: 4 memories, 1 decisions, 0 vault transactions, suspends 0 payee(s)
Seed this quarantine on-chain? [y/N]
```

The preview applies a hypothetical seed to the current projection without writing anything. It counts the memories, the payment decisions among them and the vault transactions those decisions sent, and lists payees whose address is the seeded source (they would be suspended too). Pass `--yes` to skip the prompt; without a terminal, `--yes` is required.

## Seed it

On confirmation, control:

1. Seals the reason, the evidence and the preview with the data key and pins them to IPFS.
2. Signs `SeedQuarantine` with the control key and sends `TyrellLedger.seedQuarantine` with the reason's CID.
3. Signs and sends `SuspendPayee` for every payee whose address is the seeded source.
4. Refreshes the projection.

The command prints the seed id, transaction hash, reason CID, preview and suspended payees.

## What quarantine does

- Every memory the seed matches directly, and every descendant, is flagged `quarantined`.
- Quarantined memories leave the model's context (they are never recalled) and the policy engine's inputs: a payment from a turn whose readSet contains one fails rule R0.
- Descendants written **after** the seed are excluded too, because quarantine is recomputed from the active seeds every time the projection is built (invariant I-8).
- Nothing is deleted or unpinned. Quarantined memories stay anchored and readable with `tyrell show <id> --forensic` and in the console (invariant I-7).
- Quarantine never touches keys. Revocation is a separate command (invariant I-9).

## Inspect the blast radius

```sh
pnpm tyrell blast <seedId>              # JSON
pnpm tyrell blast <seedId> --mermaid    # a Mermaid graph
```

| Field | Meaning |
| --- | --- |
| `memories` | Every memory the seed reaches |
| `decisions` | The payment decisions among them |
| `vaultTxs` | Transaction hashes of payments those decisions sent |
| `nodes` | Sources, memories and decisions, with lane, class and quarantine flag |
| `edges` | Source to memory, and parent to child |

The [console](/console)'s **Blast radius** tab draws the same graph for any seed, and the T-19 test checks it matches `tyrell blast` exactly.

## Automatic quarantine

The ingest worker seeds a `source` quarantine on its own in one case: a blocklisted address (score 100), when `AUTO_QUARANTINE_BLOCKLIST` is `true` (the default). It seeds the address that actually matched (the token, or the sender when the sender is the blocklisted one), once per scan, and control skips it if an active seed already covers that source. The request is signed with the wallet key, which may only seed sources. Every other incident only *proposes* a seed (`proposedSeed`) for a human to confirm. See [AI sentinel](/docs/guides/ai-sentinel).

## Release a seed

Only the user key can release a seed:

```sh
pnpm tyrell release <seedId> --reason "false positive: the token is the landlord's own"
```

The CLI first records the reason as your own statement (a trusted user-lane memory, `Released quarantine seed <id>: <why>`), then signs `ReleaseQuarantine` with the user key, with that memory's CID as the reason, and control relays it. `--reason-cid <cid>` uses an existing IPFS CID instead. After the next refresh, the seed's memories are visible again unless another active seed still covers them.

> [!NOTE]
> Releasing a seed does not reinstate a payee it suspended. Run `tyrell payee reinstate <label>` for that.

## A typical recovery

```sh
pnpm tyrell incidents                                            # find the source
pnpm tyrell quarantine --source <token> --reason "..."           # preview, confirm, seed
pnpm tyrell blast <seedId> --mermaid                             # what it reached, plus the console link
pnpm tyrell steward "pay this month's rent"                      # now ALLOW, from clean memory
pnpm tyrell verify --head <block>                                # prove the clean state rebuilds from chain
```

## Choosing a seed type

| Situation | Seed |
| --- | --- |
| A poisoned token, NFT collection or sender | `source` with the contract or sender address |
| One bad transaction | `source` with the transaction hash |
| A lane key leaked between two blocks | `signer-window`, then revoke the key |
| A turn went wrong (the model was manipulated) | `turn` |
| One specific memory | `memory` |
