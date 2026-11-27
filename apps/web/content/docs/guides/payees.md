---
title: Payees
description: Register who the agent may pay, by QIE ID or address, with per-payment and daily caps, and remove, reinstate or suspend payees.
---

A **payee** is the only kind of recipient Tyrell will ever pay. Payees live on `TyrellLedger` and can only be created by a signature from the user lane key, which only the human CLI holds. The model can suggest a payee in conversation but can never create one.

## Payee fields

| Field | Type | Meaning |
| --- | --- | --- |
| `payeeId` | `bytes32` | `keccak256("payee:" + label)`, so a label maps to one id |
| `addr` | `address` | The exact recipient address |
| `token` | `address` | The only token this payee can be paid in |
| `capPerTx` | `uint128` | Largest single payment, in token base units (must be > 0) |
| `capPerDay` | `uint128` | Most this payee can receive per UTC day (must be >= `capPerTx`) |
| `label` | `string` | 1 to 64 bytes; the CLI allows letters, digits, space, `_`, `.` and `-` |
| `active` | `bool` | False after removal |
| `suspended` | `bool` | True after a control-lane suspension tied to a quarantine seed |

## Add a payee

### By QIE ID (mainnet)

```sh
pnpm tyrell payee add --label landlord --qie-id landlord.qie --cap 5 --daily 5
```

The CLI resolves the QIE ID once, now, through the QIE MCP server (`qie_resolve_name`), then requires the address to reverse-resolve to the same name (`qie_reverse_lookup`). If the round-trip fails, nothing is signed. A bare label gets `.qie` appended.

> [!NOTE]
> Names are never resolved at payment time. After registration the payee is an exact address on-chain, and the policy engine compares addresses only (rule R1).

### By address

```sh
pnpm tyrell payee add --label landlord --address 0x1234…abcd --cap 5 --daily 5
```

QIE ID is not deployed on testnet, so use `--address` there.

### Confirmation

Before signing, the CLI prints the resolved address and asks you to type its last six characters. Pass `--confirm <last6>` to answer non-interactively. A mismatch rejects the payee.

### What happens

1. The CLI converts `--cap` and `--daily` from token units to base units using the token's `decimals()`.
2. It signs an EIP-712 `AddPayee` message with the user key, with the next nonce for that key and a deadline one hour after the latest block.
3. Control relays the transaction (its submitter key pays the gas). Control can relay a user signature but cannot change it.
4. `TyrellLedger.addPayee` verifies the signature against the active user lane key, burns the nonce and stores the payee.

`--token` defaults to the vault's token. A payee in any other token can be registered, but the vault will only pay it if a global daily cap is set for that token.

## List payees

```sh
pnpm tyrell payee list
```

Reads the ledger at the latest block and prints every payee with its caps and flags.

## Remove and reinstate

```sh
pnpm tyrell payee remove landlord
pnpm tyrell payee reinstate landlord
```

Both are user-lane signatures. `remove` sets `active = false`; `reinstate` sets `active = true` and clears `suspended`. A removed payee keeps its record, so its id cannot be reused for a different address.

## Suspension

When control seeds a `source` quarantine whose value is a payee's address, the payee is suspended too: control signs `SuspendPayee` with the control key, referencing the active seed. A suspended payee cannot be paid (`PAYEE_SUSPENDED`) until the user reinstates it.

Control can suspend a payee but can never add or reinstate one. That asymmetry is deliberate: a compromised control key can stop payments, not redirect them.

## Caps and the worst case

Three caps bound every payment, checked off-chain by the policy engine and again on-chain by the vault:

| Cap | Where | Checked |
| --- | --- | --- |
| `capPerTx` | Payee on `TyrellLedger` | `0 < amount <= capPerTx` |
| `capPerDay` | Payee on `TyrellLedger` | Payee spend today + amount <= `capPerDay` |
| `globalDailyCap[token]` | `GuardedVault` | Vault-wide spend today in that token + amount <= cap |

"Today" is `block.timestamp / 86400`, the UTC day, in both places. A token with no global daily cap cannot be paid at all.

`tyrell check caps --max <units>` prints the worst-case daily loss, the minimum of the vault cap, the sum of active payees' daily caps and the vault balance, and fails unless it is within your limit.

## How payees stop attacks

| Attack | Stopped by |
| --- | --- |
| "Landlord moved, pay 0xBAD…" | `0xBAD…` is not a registered payee: `UNKNOWN_RECIPIENT` |
| Correct label, wrong address | The address is not a payee: `UNKNOWN_RECIPIENT` |
| Homoglyph label (`landIord`) | Labels compare after trimming and ASCII lower-casing only: `LABEL_MISMATCH` |
| Look-alike address from a dust transfer | Exact address comparison: `UNKNOWN_RECIPIENT` |
| Fake token with the same symbol | The token must equal the payee's token: `ASSET_MISMATCH` |
| One large payment | `OVER_CAP` |
| Many small payments | `OVER_DAILY_CAP` |

See [Policy rules](/docs/reference/policy-rules) for the full rule order.
