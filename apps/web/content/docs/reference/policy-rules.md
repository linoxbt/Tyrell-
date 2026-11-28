---
title: Policy Rules
description: The payment policy engine's rules R0 to R5, its inputs, every block code, and how the vault re-checks the same rules on-chain.
---

Every payment the agent proposes is evaluated by a pure policy engine in `packages/core/src/policy.ts`. It has no I/O, no clock reads and no model calls: everything it needs is passed in, so every rule and block code is unit-tested, with 100% statement and branch coverage enforced. The reason and citations in a proposal are never read and cannot change a verdict.

Rules run in order and **the first BLOCK wins**. Without a successful simulation nothing is allowed.

## Inputs

### PaymentProposal

What Steward's `propose_payment` tool produces, after the runtime converts the amount to base units.

| Field | Type | Read by the engine |
| --- | --- | --- |
| `recipient` | string | Yes |
| `amount` | bigint (base units) | Yes |
| `token` | string (address) | Yes |
| `payeeLabel` | string, optional | Yes |
| `reason` | string, optional | **No** |
| `cites` | string[], optional | **No** |

### LedgerState

| Field | Meaning |
| --- | --- |
| `verified` | Ledger and lane registry reads succeeded and matched on two RPC endpoints |
| `payees` | Every payee from `TyrellLedger`, each with `spentToday` from `GuardedVault.spentToday` |
| `globalDailyCap` | `GuardedVault.globalDailyCap(token)`, by lowercase token address |
| `spentTodayGlobal` | `GuardedVault.spentTodayGlobal(token)`, by lowercase token address |
| `day` | The UTC day (`timestamp / 86400`) the spend figures were read for |

### ChainState

| Field | Meaning |
| --- | --- |
| `endpointsAgree` | Two RPC endpoints answered and agree on head and contract state |
| `contextVerified` | Every memory in the turn's readSet is verified and not quarantined |
| `blockNumber`, `blockTimestamp` | The evaluated block; "today" is `blockTimestamp / 86400` |
| `simulation` | Result of `eth_call` and gas estimation of `GuardedVault.pay` from the signer's address |

Control reads all of this at the projection's head, on two endpoints, before every decision. The chain state behind the projection is compared on every field of the whole history; a third endpoint breaks a tie (see [Architecture](/docs/get-started/architecture#the-projection)).

## The rules

### R0: verified state, fail closed

| Condition | Block code | Reason |
| --- | --- | --- |
| Endpoints unavailable or disagree | `CHAIN_UNAVAILABLE` | "RPC endpoints unavailable or disagree" |
| Ledger or registry reads not verified on two endpoints | `LEDGER_UNVERIFIED` | "ledger or registry reads not verified on two endpoints" |
| A memory in the turn's context failed verification or is quarantined | `LEDGER_UNVERIFIED` | "a memory in the turn's context failed verification" |
| Spend figures are not for the current UTC day | `LEDGER_UNVERIFIED` | "spend figures are not for the current UTC day" |

If control cannot even read and cross-check chain state, the decision is `CHAIN_UNAVAILABLE` without running the engine. Control also blocks in two cases of its own, both with `LEDGER_UNVERIFIED`:

- the turn read more than 64 memories, more than a decision record can cite as parents;
- an earlier allowed payment to the same payee has no settled outcome yet (the signer's answer was lost and the chain has not shown what happened), so a lost answer can never become a second payment.

### R1: canonical recipient

The recipient must be a `0x`-prefixed 40-hex-character address with a valid EIP-55 checksum (`isAddress(…, { strict: true })`). Otherwise `BAD_RECIPIENT`. Names are never resolved at payment time.

### R2: registered payee

Among payees at exactly that address (case-insensitive), at least one must be active and not suspended.

| Condition | Block code |
| --- | --- |
| A payee at the address is active but suspended | `PAYEE_SUSPENDED` |
| No payable payee at the address | `UNKNOWN_RECIPIENT` |

### R3: label

If the proposal has a `payeeLabel`, it must name a payee at that same address. Labels are compared after trimming and ASCII lower-casing **only**, so a homoglyph such as `landIord` (capital i) does not match `landlord`. Otherwise `LABEL_MISMATCH`.

### R4: token and caps

| Condition | Block code |
| --- | --- |
| No candidate payee has this token | `ASSET_MISMATCH` |
| `amount <= 0` or `amount > capPerTx` | `OVER_CAP` |
| Payee's `spentToday + amount > capPerDay` | `OVER_DAILY_CAP` |
| Vault's `spentTodayGlobal + amount > globalDailyCap` for the token (a token with no cap has cap 0) | `OVER_DAILY_CAP` |

When R0 to R4 pass, the engine returns the exact call: payee id, the payee's address, token and amount.

### R4a: agent registry

Applies only when the deployment is a registered agent of the [agents network](/docs/agents/overview) (its deployment file has `agentRegistry` and `agentId`). Control reads, at the evaluated block and on two endpoints, `AgentRegistry.check(agentId, payeeId, token, amount)` for the payee R2 to R4 chose, and compares `AgentRegistry.agent(agentId).key` with the active agent-lane key. The result is passed to the engine as an `AgentCheck { agentId, verified, ok, code }`.

| Condition | Block code |
| --- | --- |
| The two reads disagree or failed | `LEDGER_UNVERIFIED` |
| The registered key is not this deployment's agent-lane key | `AGENT_BLOCKED` (reason `agent N: AGENT_KEY_MISMATCH`) |
| The registry refuses: `HUMAN_UNBOUND`, `HUMAN_FROZEN`, `AGENT_REVOKED`, `AGENT_BANNED`, `NOT_PERMITTED`, `PAYEE_NOT_DELEGATED`, `OVER_AGENT_TX_LIMIT`, `OVER_AGENT_DAILY_LIMIT`, `OVER_HUMAN_QUOTA` | `AGENT_BLOCKED` (reason `agent N: <code>`) |

R4a is `checkAgent(verdict, agent)` in `@tyrell/core`; `evaluatePayment(p, ledger, chain, agent?)` applies it between R4 and R5. For a registered agent, R5 simulates `GuardedVault.payForAgent` instead of `pay`.

### R5: simulation

Control simulates that exact `GuardedVault.pay(payeeId, token, amount, decisionId)` from the signer's address and estimates its gas.

| Condition | Block code |
| --- | --- |
| No simulation was run | `SIMULATION_FAILED` |
| The simulation reverted | `SIMULATION_FAILED`, with the revert name and arguments in the reason |

If R5 passes the verdict is `ALLOW` with code `OK` and reason "R0-R5 passed".

## Block codes

| Code | Rule | Meaning |
| --- | --- | --- |
| `CHAIN_UNAVAILABLE` | R0 | Chain state could not be read or cross-checked |
| `LEDGER_UNVERIFIED` | R0 | State not verified, context not verified, or stale spend figures |
| `BAD_RECIPIENT` | R1 | Not a canonical checksummed address |
| `UNKNOWN_RECIPIENT` | R2 | Not a registered payee |
| `PAYEE_SUSPENDED` | R2 | The payee is suspended by a quarantine seed |
| `LABEL_MISMATCH` | R3 | The label does not name the payee at that address |
| `ASSET_MISMATCH` | R4 | Wrong token |
| `OVER_CAP` | R4 | Zero, negative or above the per-payment cap |
| `OVER_DAILY_CAP` | R4 | Above the payee's or the vault's daily cap |
| `AGENT_BLOCKED` | R4a | The agent registry refuses this agent's spend (code in the reason) |
| `SIMULATION_FAILED` | R5 | The vault call would revert, or was not simulated |

## After the verdict

### On ALLOW

1. Control builds a pay request `{ chainId, vault, payeeId, token, amount, decisionId }`, hashes it (with the tag `tyrell.signer.pay.v1`) and signs the hash with the control lane key (EIP-191).
2. The signer process recovers the signer, requires `LaneRegistry.isActiveFor(signer, Control)`, rejects a decision id already seen or already `decisionUsed` on-chain, simulates the call again, and only then sends `GuardedVault.pay`.
3. The vault checks the ledger's `isPayable`, the payee's daily cap and the token's global daily cap again on-chain.

### Always

Control writes a **decision memory**: control lane, kind `decision`, namespace `tyrell.control`, id equal to the decision id the vault saw, parents equal to the turn's readSet. Its body is JSON:

```json
{
  "decisionId": "0x…",
  "turn": "0x…",
  "proposal": { "recipient": "0x…", "amount": "5000000", "token": "0x…", "payeeLabel": "landlord", "reason": "…" },
  "verdict": { "decision": "BLOCK", "code": "UNKNOWN_RECIPIENT", "reasons": ["recipient is not a registered payee"] },
  "txHash": "0x…",
  "payError": "…"
}
```

`txHash` is present when a payment was sent; `payError` when the signer refused or the transaction failed. Because decisions are memories, a quarantine's blast radius includes the decisions and vault transactions a poisoned source reached.

## On-chain equivalents

| Off-chain rule | On-chain check in `GuardedVault.pay` |
| --- | --- |
| R2 registered, active, not suspended | `isPayable`: `UNKNOWN_PAYEE`, `PAYEE_REMOVED`, `PAYEE_SUSPENDED` |
| R4 token | `isPayable`: `ASSET_MISMATCH` |
| R4 per-payment cap | `isPayable`: `ZERO_AMOUNT`, `OVER_CAP` |
| R4 payee daily cap | `NotPayable("OVER_DAILY_CAP")` |
| R4 vault daily cap | `NotPayable("OVER_GLOBAL_DAILY_CAP")` |
| One payment per decision | `BadDecision()` |

So even a fully compromised control process, or a stolen signer key, can only pay registered payees within their caps (invariant I-5).

## Console view

The console's Overview tab shows the latest decision as a trace through R0 to R5: rules before the blocking one pass, the blocking rule fails, and later rules are never reached. See [Web console and wallet](/docs/guides/web-console-and-wallet).
