---
title: View Document
description: The JSON document control serves to the web console and writes as a snapshot, field by field.
---

The view document is everything the web console needs, in one JSON document. Control builds it from the current projection and serves it read-only at `GET http://127.0.0.1:7878/api/view` (`TYRELL_API_PORT` changes the port), to requests carrying its bearer token. `tyrell snapshot --out <file>` writes the same document to a file, which is how the hosted demo runs; by default the snapshot leaves memory contents out (see [Snapshots](#snapshots)). The web app serves it at `/api/view`, from control when `TYRELL_API_URL` is set and from `public/snapshot.json` otherwise.

The source of truth is `ViewDocument` in `apps/control/src/view.ts`.

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `v` | `1` | Document version |
| `generatedAt` | string | ISO 8601 time the document was built |
| `network` | string | `mainnet`, `testnet` or `local` |
| `chainId` | number | 1990, 1983 or a local chain id |
| `head` | string | Block number of the projection (decimal string) |
| `digest` | hex | The [projection digest](/docs/guides/rebuild-and-verify#the-projection-digest) at `head` |
| `contracts` | object | Contract addresses by name: `laneRegistry`, `memoryAnchor`, `tyrellLedger`, `guardedVault`, `token` |
| `explorer` | string, optional | Block explorer base URL |
| `token` | object, optional | The vault token: `address`, `decimals`, `symbol` |
| `memories` | ViewMemory[] | Every memory, excluded ones included |
| `decisions` | ViewDecision[] | Every payment decision |
| `seeds` | object[] | Every quarantine seed |
| `payees` | object[] | Every payee |
| `incidents` | object[] | Sentinel incidents |
| `redacted` | `true`, optional | Present on a snapshot written without `--include-bodies` |

## ViewMemory

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | hex | Memory id |
| `lane` | number | 1–4, or 0 if unknown |
| `laneName` | string | `user`, `agent`, `wallet`, `control` or `unknown` |
| `kind` | number | 1–5, or 0 if unknown |
| `cls` | string | `trusted`, `derived`, `untrusted` or `unverified` |
| `clsReason` | string | Why, for example `trusted by lane`, `parent 0x… is untrusted`, or a verification reason |
| `quarantined` | boolean | Excluded by an active seed |
| `seeds` | number[] | Seeds that quarantine it, directly or through an ancestor |
| `parents` | hex[] | Parent ids |
| `signer` | address, optional | The key that signed it |
| `block` | string, optional | Anchor block |
| `logIndex` | number, optional | Anchor log index |
| `cid` | string, optional | IPFS CID of the sealed blob |
| `verification` | string | `verified` or the verification failure reason |
| `body` | string, optional | The decrypted body; kept for excluded memories too, for forensics |
| `src` | object[] | The header's `src` references |
| `ts` | string, optional | The header's timestamp |

## ViewDecision

Built from every memory of kind `decision`:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | hex | The decision id, also used as the vault's `decisionId` |
| `turn` | hex, optional | The Steward turn that proposed it |
| `verdict` | object, optional | `decision` (`ALLOW` or `BLOCK`), `code`, `reasons` |
| `proposal` | object, optional | The proposal as received: `recipient`, `amount` (base units), `token`, `payeeLabel`, `reason`, `cites` |
| `outcome` | string, optional | What happened to an allowed payment: `paid`, `failed` or `unknown` (the signer's answer was lost and the chain has not settled it yet), from control's outcome record |
| `txHash` | hex, optional | The vault payment transaction |
| `payError` | string, optional | Why an allowed payment was not paid, for example a signer refusal |
| `parents` | hex[] | What the model had read in that turn |

Control writes the decision record before it asks the signer to pay, then records the outcome as a separate control-lane note whose parent is the decision: `{ "outcomeOf": <decision id>, "status": "paid" | "failed" | "unknown", "txHash"?, "payError"? }`. `outcome`, `txHash` and `payError` come from that note. Those notes are ordinary memories, so they also appear in `memories`.

## Seeds

| Field | Type | Meaning |
| --- | --- | --- |
| `seedId` | number | Seed id on `TyrellLedger` |
| `type` | number | 1 memory, 2 source, 3 signer-window, 4 turn |
| `value` | hex | 32-byte seed value |
| `fromBlock`, `toBlock` | string | Block range (signer-window only; `"0"` otherwise) |
| `released` | boolean | Released by the user key |

## Payees

| Field | Type | Meaning |
| --- | --- | --- |
| `payeeId` | hex | `keccak256("payee:" + label)` |
| `label` | string | The label |
| `addr` | address | The recipient |
| `token` | address | The payee's token |
| `capPerTx`, `capPerDay` | string | Caps in base units |
| `active`, `suspended` | boolean | Status flags |

## Incidents

The incident records the ingest worker sent to control, unchanged. See [AI sentinel](/docs/guides/ai-sentinel#incidents) for the fields, including the optional `ai` verdict.

## Example

```json
{
  "v": 1,
  "generatedAt": "2026-11-27T06:11:30.000Z",
  "network": "local",
  "chainId": 31337,
  "head": "30",
  "digest": "0xb7ec02…",
  "contracts": { "laneRegistry": "0x…", "memoryAnchor": "0x…", "tyrellLedger": "0x…", "guardedVault": "0x…", "token": "0x…" },
  "token": { "address": "0x…", "decimals": 6, "symbol": "tUSD" },
  "memories": [
    {
      "id": "0x01a2…",
      "lane": 1,
      "laneName": "user",
      "kind": 1,
      "cls": "trusted",
      "clsReason": "trusted by lane",
      "quarantined": false,
      "seeds": [],
      "parents": [],
      "verification": "verified",
      "body": "pay rent to landlord (0xDF59…), 5 QUSDC, on the 1st",
      "src": [{ "t": "user-msg", "id": "cli-…" }]
    }
  ],
  "decisions": [],
  "seeds": [],
  "payees": [],
  "incidents": []
}
```

## Snapshots

`tyrell snapshot --out <file>` removes, by default, every memory's `body`, the `reason` in each decision's `proposal`, each incident's `summary` and the AI judge's `reason`, and sets `"redacted": true`. Everything else (ids, lanes, classes, lineage, verdicts, transactions) stays, so the console still draws the full picture. `--include-bodies` keeps the plain text, for demo data you mean to publish.

## Security

The API is bound to `127.0.0.1` and accepts only `GET /api/view` with `Authorization: Bearer <token>` (the token is `TYRELL_API_TOKEN` or `TYRELL_HOME/api-token`); a missing or wrong token gets 401 and any other path 404. It also refuses any `Host` header but `127.0.0.1`, `localhost` or `[::1]` (421), so a web page that rebinds its own domain to your machine cannot read it. It returns 503 until control has built its first projection. The web server proxies it with a 10-second timeout, sending `TYRELL_API_TOKEN` as the bearer token; if control does not answer, the web app falls back to the snapshot. The browser never talks to control.

> [!WARNING]
> The document contains decrypted memory bodies. Serve it only to people who may read the agent's memory. The hosted demo's snapshot comes from a demo run with no real data, written with `--include-bodies` on purpose.
