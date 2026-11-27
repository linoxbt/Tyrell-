---
title: Envelope Format
description: The memory envelope schema, its EIP-712 typed data, hashing rules, encryption, and the typed data for every TyrellLedger action.
---

Every memory is an envelope: a header, a UTF-8 body and an EIP-712 signature by a lane key. This page defines the exact encoding, so any implementation can produce envelopes that control and `MemoryAnchor` accept. The reference implementation is `packages/core` (`envelope.ts`, `typedData.ts`, `sign.ts`).

## Blob

What is encrypted and pinned:

```json
{
  "header": { "…": "see below" },
  "body": "pay rent to landlord, 5 QUSDC, on the 1st",
  "signature": "0x…(65 bytes, hex)"
}
```

Unknown fields are rejected everywhere, so hashes stay stable.

## Header

| Field | Type | Rules |
| --- | --- | --- |
| `v` | number | Exactly `1` |
| `id` | 16-byte hex | Lowercase, not zero. UUIDv7 (time-ordered) by default |
| `acct` | 32-byte hex | Lowercase; the deployment's account id |
| `ns` | string | `steward.mem` or `tyrell.control` |
| `lane` | integer | 1 user, 2 agent, 3 wallet, 4 control |
| `kind` | integer | 1 statement, 2 observation, 3 note, 4 summary, 5 decision |
| `parents` | 16-byte hex[] | At most 64; sorted ascending, unique, never containing `id` |
| `src` | SrcRef[] | At most 32 |
| `turn` | 16-byte hex | The Steward turn, or 16 zero bytes |
| `refBlock` | integer | A recent block; must not exceed the anchor block |
| `ts` | string | ISO 8601 with offset |
| `bodyLen` | integer | Body length in UTF-8 bytes, at most 8,192 |

### SrcRef

Discriminated by `t`:

| `t` | Fields | Used for |
| --- | --- | --- |
| `erc20` | `addr`, `tx?`, `from?` | A token contract |
| `nft` | `addr`, `tokenId` (decimal string), `tx?`, `from?` | An NFT |
| `transfer` | `addr`, `tx`, `from` | A transfer observed by ingest |
| `mcp` | `tool` (1–64 chars), `args` (object) | An MCP tool call |
| `user-msg` | `id` (1–64 chars) | A user statement |
| `external` | `url?` (≤ 2048), `note?` (≤ 256) | Anything else |

`addr` and `from` are EVM addresses; `tx` is a lowercase 32-byte hex hash. Quarantine `source` seeds match a memory through any address or transaction hash in its `src`.

## The signed struct

The lane key signs an EIP-712 `Memory` struct derived from the header and body:

```solidity
Memory(bytes16 id,bytes32 acct,bytes32 ns,uint8 lane,uint8 kind,bytes32 parentsHash,bytes32 srcHash,bytes16 turn,uint64 refBlock,bytes32 bodyHash,uint32 bodyLen)
```

| Struct field | Derived as |
| --- | --- |
| `ns` | `keccak256(utf8(header.ns))` |
| `parentsHash` | `keccak256(concat(sorted parent ids))`; `keccak256(0x)` for no parents |
| `srcHash` | `keccak256(utf8(RFC 8785 canonical JSON of header.src))` |
| `bodyHash` | `keccak256(utf8(body))` |
| `refBlock` | `uint64(header.refBlock)` |
| other fields | Copied from the header |

### Domain

```json
{ "name": "Tyrell", "version": "1", "chainId": 1990, "verifyingContract": "<MemoryAnchor address>" }
```

### Signing in TypeScript

```ts
import { signEnvelope } from "@tyrell/core";

const blob = await signEnvelope(laneAccount, { chainId, memoryAnchor }, {
  acct,
  lane: 2,            // agent
  kind: 3,            // note
  body: JSON.stringify({ text: "Rent is due on the 1st" }),
  refBlock: await client.getBlockNumber(),
  parents: readSet,   // sorted and de-duplicated for you
  turn,
});
```

`signEnvelope` fills `v`, a UUIDv7 `id`, `ts`, `bodyLen`, the default namespace `steward.mem`, sorts the parents and signs with `signTypedData`.

### Verifying

`MemoryAnchor.hashMemory(m)` returns the struct hash and `digestOf(m)` the full digest, so an implementation can check its encoding against the chain. The anchored `structHash` commits to every header field, which is how verification step 3 detects any change to the header.

## Encryption

Control seals the blob before pinning:

| Property | Value |
| --- | --- |
| Cipher | AES-256-GCM |
| Key | The 32-byte data key |
| Nonce | 12 random bytes |
| Additional authenticated data | `acct` (32 bytes) followed by `id` (16 bytes) |
| Plaintext | The blob's JSON |
| Output | `nonce ‖ ciphertext ‖ tag` |

Binding `acct` and `id` into the AAD means a sealed blob cannot be replayed under another id or account.

## Memory kinds

| Kind | ID | Typical lane | Body |
| --- | --- | --- | --- |
| statement | 1 | user | Plain text from `tyrell say` |
| observation | 2 | wallet | A description of a transfer, token or NFT, or an MCP result |
| note | 3 | agent | JSON `{ "text", "cites"? }` |
| summary | 4 | agent | JSON `{ "text", "cites"? }` |
| decision | 5 | control | JSON decision record (see [Policy rules](/docs/reference/policy-rules#always)) |

## Ledger actions

`TyrellLedger` actions are EIP-712 messages with the domain `{ name: "TyrellLedger", version: "1", chainId, verifyingContract: <TyrellLedger> }`. Every action has a `nonce` (strictly greater than the signer's `lastNonce`) and a `deadline` (Unix seconds).

| Primary type | Fields | Signed by |
| --- | --- | --- |
| `AddPayee` | `bytes32 payeeId, address addr, address token, uint128 capPerTx, uint128 capPerDay, string label, uint256 nonce, uint64 deadline` | user |
| `RemovePayee` | `bytes32 payeeId, uint256 nonce, uint64 deadline` | user |
| `ReinstatePayee` | `bytes32 payeeId, uint256 nonce, uint64 deadline` | user |
| `ReleaseQuarantine` | `uint256 seedId, string reasonCid, uint256 nonce, uint64 deadline` | user |
| `SeedQuarantine` | `uint8 seedType, bytes32 seedValue, uint64 fromBlock, uint64 toBlock, string reasonCid, uint256 nonce, uint64 deadline` | control |
| `SuspendPayee` | `bytes32 payeeId, uint256 seedId, uint256 nonce, uint64 deadline` | control |

`payeeId` is `keccak256(utf8("payee:" + label))` (`payeeIdOf` in `@tyrell/core`).

### Seed values

| Seed type | `seedValue` encoding |
| --- | --- |
| memory (1) | The 16-byte id, right-padded to 32 bytes |
| source (2) | An address left-padded to 32 bytes, or a 32-byte transaction hash |
| signer-window (3) | The signer address, left-padded |
| turn (4) | The 16-byte turn id, right-padded |

## Pay requests

Control asks the signer for a payment with an EIP-191 signature over:

```text
keccak256(abi.encode(
  keccak256("tyrell.signer.pay.v1"),
  uint256 chainId, address vault, bytes32 payeeId, address token, uint256 amount, bytes16 decisionId
))
```

The signer accepts it only if it recovers to the active control lane key.
