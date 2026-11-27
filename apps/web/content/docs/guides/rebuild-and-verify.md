---
title: Rebuild and Verify
description: Reconstruct the whole projection from QIE and IPFS alone and prove its digest matches the live control process.
---

The local SQLite database is only a cache. Everything that decides what the agent may believe, and who it may pay, is on QIE or in encrypted blobs on IPFS. `tyrell rebuild --fresh` proves it by reconstructing the projection from nothing, and `tyrell verify` proves the result is identical to what the live process holds (invariant I-10).

## What you need

| Input | Source |
| --- | --- |
| Data key | `TYRELL_HOME/keys/data.json` and its passphrase |
| Account id and contract addresses | `config.json` and `deployment-<chainId>.json` |
| RPC endpoints | `config.json` (`QIE_RPC_URLS` overrides) |
| Blob store | Pinata with `PINATA_JWT`, or the local blob directory |

Nothing else: not the old database, not control's memory, not any incident.

## Rebuild

```sh
pnpm tyrell rebuild --fresh --out /tmp/rebuild.sqlite
```

| Option | Meaning |
| --- | --- |
| `--fresh` | Required. Start from an empty database |
| `--out <path>` | Write here instead of the live database path |
| `--head <block>` | Rebuild as of this block |

Without `--out`, the rebuild replaces the live database, so it refuses while control is running: stop control first, or use `--out` for a side-by-side rebuild.

The rebuild reads lane key events, anchors and ledger state, fetches and decrypts every blob, verifies every memory, computes classes and quarantine, and prints:

```json
{
  "head": "12345",
  "digest": "0x…",
  "ms": 1520,
  "memories": 42,
  "verified": 41,
  "unverified": { "BODY_UNAVAILABLE": 1 },
  "quarantined": 4,
  "visible": 37
}
```

| Field | Meaning |
| --- | --- |
| `memories` | Anchored memories found on-chain |
| `verified` | Memories that passed all six verification steps |
| `unverified` | Count per [verification reason](/docs/reference/errors#verification-reasons) |
| `quarantined` | Memories excluded by an active seed |
| `visible` | Verified, unquarantined memories the model may recall |

Without `--head`, the rebuild reads up to the latest block (no confirmation lag).

A 500-memory history rebuilds in about 1.5 seconds locally.

## Verify

```sh
pnpm tyrell verify --head <block>
```

`verify` asks the live control process for its digest and digest document at `<block>`, runs a fresh rebuild at the same head into a temporary directory, and compares. It prints:

| Field | Meaning |
| --- | --- |
| `head` | The block compared at |
| `live` | Control's digest |
| `rebuilt` | The fresh rebuild's digest |
| `match` | `true` if identical |
| `firstDifference` | The first record that differs, if any |
| `rebuildMs` | How long the rebuild took |

It exits with code 2 on a mismatch.

## The projection digest

The digest is keccak256 of the RFC 8785 canonical JSON of this document:

```json
{
  "v": 1,
  "acct": "0x…",
  "head": "12345",
  "memories": [{ "id": "0x…", "lane": 1, "cls": "trusted", "q": false, "bodyHash": "0x…" }],
  "payees":   [{ "payeeId": "0x…", "addr": "0x…", "token": "0x…", "capPerTx": "5000000", "capPerDay": "5000000", "active": true, "suspended": false }],
  "seeds":    [{ "seedId": 1, "type": 2, "value": "0x…", "from": "0", "to": "0", "released": false }]
}
```

Integers that may exceed 2^53 are decimal strings, addresses and hashes are lowercase, and every list is sorted by its key. Two processes with the same chain and blobs at the same head always produce the same digest; any difference in a class, a quarantine flag, a payee or a seed changes it. `firstDifference` names the first differing field so you can see why.

## Why it is deterministic

- The live process and `rebuild --fresh` share the same projection code.
- Memories are processed in anchor order (block, then log index), which is a topological order because a parent must be anchored before its child.
- Quarantine is computed from the seeds on the ledger at the head, never from local state.
- Lane bindings are rebuilt from `LaneRegistry` events, so a memory signed before a key was revoked keeps its lane.

## What is not rebuilt

| Data | Why |
| --- | --- |
| Sentinel incidents | Local detection hints; they never change a class or a payment |
| The recall index | Derived from the projection, rebuilt with it |

## When to use it

- After moving to a new machine: rebuild from the chain instead of copying a database.
- After a suspected tampering of the local database: rebuild and compare.
- As evidence: `verify` matching at a given head is the proof that the console shows what the chain says.
