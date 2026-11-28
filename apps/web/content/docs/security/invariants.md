---
title: Invariants
description: Tyrell's twelve invariants, the code that enforces each one and the tests that check it.
---

Tyrell's claims are exactly these twelve invariants. Each one is enforced in code, usually in two places, and each has tests. Nothing in this list depends on the language model behaving.

## Summary

| ID | Invariant | Enforced by | Tests |
| --- | --- | --- | --- |
| I-1 | A memory's lane is the lane of the key whose EIP-712 signature verifies | `MemoryAnchor._laneSigner`; `verifyMemory` step 5 | T-03 (Foundry, anvil end-to-end), `testFuzz_onlyActiveLaneKeysAnchor`, attack 9 |
| I-2 | Default deny: anything unverifiable is `unverified` and authorises nothing | `verifyMemory` (17 reasons), `computeProjection` | `verifier.test.ts` (100% branches), T-05 |
| I-3 | Taint is monotonic; the runtime sets parents = readSet | `Steward.tool` (`write_note`, `propose_payment`), `computeProjection` | T-06, T-07, attack 10 |
| I-4 | The model cannot mint trust | Only the human CLI holds the user key; Steward holds the agent key | `say` CLI test, attack 9 |
| I-5 | Payments are authorised by code, twice | `evaluatePayment` R0–R5; `GuardedVault.pay` / `payForAgent`; the decision is recorded before anything is paid | T-10 table, T-11, `invariant_outflowOnlyToRegisteredPayees`, attack set |
| I-6 | Fail closed | R0: two endpoints must agree on the full history (a third breaks ties), spend figures must be for today, context must be verified | `policy.test.ts` R0 cases |
| I-7 | Exclusion, not deletion | No unpin or delete path; quarantined memories stay readable in forensic mode | `nfr07.test.ts`, loop test |
| I-8 | Quarantine closure is live | Seeds applied at projection time, in anchor order | T-08, loop test |
| I-9 | Revocation is independent of quarantine | Separate contracts and commands | T-04, T-17 |
| I-10 | Restore is deterministic | `rebuildFresh` shares the projection code with the live process | T-14 (control, CLI, M1, loop), NFR-03 |
| I-11 | The ledger is on-chain, with per-action signer lanes | `TyrellLedger._consume` | `TyrellLedger.t.sol`, T-16 |
| I-12 | Keys are separated | One keystore and one passphrase per role, the role bound into the keystore MAC; `account()` refuses foreign roles; off a local chain a process that can open another role's key aborts; control acts only on requests signed by the right lane key | Storage tests, CLI key-leak test, IPC auth tests |

## Details

### I-1: lane binding

A memory's lane is not a claim; it is a fact about its signature. `MemoryAnchor` recovers the signer of the EIP-712 digest and requires `LaneRegistry` to report that key active and bound to the memory's lane, or it reverts (`UnknownSigner`, `KeyRevoked`, `LaneMismatch`). Off-chain, verification step 5 checks the binding at the memory's anchor position using the full `LaneRegistry` history, so memories signed before a key was revoked stay valid and those after do not.

### I-2: default deny

Verification stops at the first failure and the memory is `unverified`. Unverified memories are never recalled, never shown to the model, and any turn that read one cannot pay (R0). Children of an unverified memory are at best `untrusted`.

### I-3: taint follows information

The runtime records every memory placed in front of the model and sets it as the parents of every write in the turn. A memory's class is never better than its worst parent's. Citations are stored for display and ignored.

### I-4: the model cannot mint trust

`trusted` is reachable only through the user lane, whose key lives only in the human CLI process. Steward has no tool that writes through another lane.

### I-5: payments authorised twice

Off-chain, the policy engine checks R0 to R5. On-chain, `GuardedVault.pay` re-checks payee status, token, per-payment cap, payee daily cap and vault daily cap, and refuses a reused decision id. A Foundry invariant test asserts that, across random sequences of calls, every token leaving the vault goes to a registered payee.

Every payment has a record: control anchors the decision (parents = everything the turn read) before it asks the signer to pay, and refuses to pay if it cannot. A turn that read more memories than a record can cite (64) is blocked. The outcome is recorded afterwards as its own control-lane note, and a payment whose outcome is unknown blocks further payments to that payee until the chain settles it, so a lost answer never pays twice. Only the control lane can write a decision record (`DECISION_NOT_CONTROL` otherwise).

### I-6: fail closed

When the system cannot be sure, it blocks: endpoints that disagree (compared on every field of the whole history, tied to the head block hash; a third endpoint breaks a tie, otherwise `CHAIN_INCONSISTENT`), ledger reads that are not verified, spend figures from another day, or any unverified or quarantined memory in the turn's context.

### I-7: exclusion, not deletion

There is no code path that unpins a blob or deletes an anchor. Quarantined memories keep their bodies, which `tyrell show --forensic` and the console display.

### I-8: live quarantine closure

The quarantine flag is recomputed from the active seeds every time the projection is built, in anchor order. A memory written after the seed that descends from a quarantined memory is quarantined without a new seed.

### I-9: revocation is independent

Revoking a key (`LaneRegistry`) and quarantining memories (`TyrellLedger`) are separate contracts and commands. Revoking a key does not quarantine what it wrote; use a `signer-window` seed for that. Quarantining does not touch keys.

### I-10: deterministic restore

`tyrell rebuild --fresh` uses the same projection code as control and produces the same digest at the same head; `tyrell verify` proves it.

### I-11: on-chain ledger with per-action lanes

Payees and seeds live only on `TyrellLedger`, and every write is signed by the lane the action requires: user for payees and releases, control for seeds and suspensions. The ledger has no owner and no admin path.

### I-12: key separation

Each role's key is its own encrypted keystore, opened with its own passphrase (`pass.d/<role>`), and its role tag is bound into the keystore's MAC, so relabelling a file breaks it. Key, passphrase and token files must be mode 600. A process refuses to load a role it is not allowed (`account()` throws). At startup it checks whether it could open another role's key (read both the key file and its passphrase): on testnet and mainnet that aborts; on a local test chain it warns, and `TYRELL_STRICT_KEYS=1` aborts there too.

Separation also holds over IPC: control acts on a payment proposal only if the agent key signed it, on an incident only if the wallet key did, and on a quarantine only if the user key did (or the wallet key, for a source seed), each with a nonce and a two-minute expiry.

## Test suites

| Suite | Count | Run |
| --- | --- | --- |
| Foundry: unit, fuzz (1,000 runs), invariants, TypeScript-signed vectors | 147 tests | `pnpm contracts:test` |
| TypeScript: unit tests and end-to-end runs on anvil | All packages | `pnpm test` |
| Coverage gate: verifier, policy engine and agent checks at 100% statements and branches | Enforced | `pnpm coverage` |
| Attack set | 10 of 10 | `pnpm tyrell attack run` |
