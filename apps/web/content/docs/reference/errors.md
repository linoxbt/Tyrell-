---
title: Errors
description: Every block code, verification reason, contract error and process refusal in Tyrell, with what causes it and what to do.
---

Tyrell fails closed and says why. This page lists every code you can see, grouped by where it comes from.

## Payment block codes

Returned by the policy engine in a decision's verdict. Rules run in order; the first block wins. See [Policy rules](/docs/reference/policy-rules).

| Code | Rule | Cause | What to do |
| --- | --- | --- | --- |
| `CHAIN_UNAVAILABLE` | R0 | RPC endpoints unavailable or disagree (`CHAIN_INCONSISTENT`, below), or chain state could not be read at all | Check `config.json` has two working, different endpoints, and ideally a third; retry |
| `LEDGER_UNVERIFIED` | R0 | Ledger or registry reads not verified on two endpoints; a memory in the turn's context is unverified or quarantined; spend figures are not for the current UTC day; the turn read more than 64 memories (a decision can cite at most 64); or an earlier payment to the same payee has no settled outcome yet | If the context was poisoned this is the intended outcome. An unsettled payment clears when control records its outcome (usually within 90 seconds), when the chain shows it paid, or after 10 minutes. Otherwise retry |
| `BAD_RECIPIENT` | R1 | Not a canonical `0x` address with a valid checksum | Propose the exact checksummed address |
| `UNKNOWN_RECIPIENT` | R2 | Not a registered payee | Add the payee with `tyrell payee add` if it is legitimate |
| `PAYEE_SUSPENDED` | R2 | The payee is suspended by a quarantine seed | Investigate, then `tyrell payee reinstate <label>` |
| `LABEL_MISMATCH` | R3 | The label does not name the payee at that address (labels compare after trim and ASCII lower-case only) | Use the exact label |
| `ASSET_MISMATCH` | R4 | The token is not the payee's token | Use the payee's token |
| `OVER_CAP` | R4 | Amount is zero or above `capPerTx` | Lower the amount |
| `OVER_DAILY_CAP` | R4 | Above the payee's daily cap or the vault's daily cap for the token | Wait for the next UTC day, or raise the cap deliberately |
| `AGENT_BLOCKED` | R4a | The agent registry refuses the spend; the reason carries its code, e.g. `agent 1: OVER_HUMAN_QUOTA` | See [registry codes](/docs/reference/contracts-agents#registry-codes): raise a limit or the quota, delegate the payee, unfreeze, or re-bind your QIE ID |
| `SIMULATION_FAILED` | R5 | `GuardedVault.pay` was not simulated or would revert | Read the revert in the reason (for example `EnforcedPause` when paused) |

The console's policy trace shows which rule failed.

### CHAIN_INCONSISTENT

Control's chain reader raises `CHAIN_INCONSISTENT` when it cannot get one agreed view of the chain: the first two endpoints disagree on the head block hash or on any field of the history or ledger, and no third endpoint agrees with either; the head block changed while reading (a reorg); or fewer than two endpoints are configured. The refresh fails, and a payment decided meanwhile is blocked with `CHAIN_UNAVAILABLE`.

## Verification reasons

Returned for memories that fail verification. Any of these makes the memory `unverified`: it is never shown to the model and authorises nothing.

| Reason | Step | Cause |
| --- | --- | --- |
| `NO_ANCHOR` | 1 | No `MemoryAnchored` event for the id |
| `BODY_UNAVAILABLE` | 2 | The CID could not be fetched from the blob store |
| `DECRYPT_FAILED` | 2 | AES-GCM authentication failed: wrong data key, wrong id or account, or tampered bytes |
| `MALFORMED_ENVELOPE` | 2 | The decrypted blob does not match the envelope schema |
| `ID_MISMATCH` | 2 | The header's id differs from the anchored id |
| `ACCOUNT_MISMATCH` | 2 | The header's account differs from the deployment's |
| `BODY_HASH_MISMATCH` | 3 | The body's hash differs from the anchored hash |
| `BODY_LEN_MISMATCH` | 3 | `bodyLen` differs from the body's byte length |
| `PARENTS_HASH_MISMATCH` | 3 | The parents differ from the anchored parents hash |
| `NAMESPACE_MISMATCH` | 3 | The namespace differs from the anchored namespace hash |
| `HEADER_HASH_MISMATCH` | 3 | Some header field differs from the anchored struct hash |
| `BAD_SIGNATURE` | 4 | The signature cannot be recovered |
| `SIGNER_MISMATCH` | 4 | The signature recovers to a different address than the anchored signer |
| `UNBOUND_KEY` | 5 | The signer was not an active lane key at the anchor's position |
| `LANE_MISMATCH` | 5 | The signer was bound to a different lane than the header claims |
| `REFBLOCK_AFTER_ANCHOR` | 6 | `refBlock` is after the anchor block |
| `DECISION_NOT_CONTROL` | 5 | A payment decision record from a lane other than control. Only control writes decisions |

A memory whose parent is anchored at or after it is also `unverified`, with a class reason starting `PARENT_ORDER:`.

## Contract errors

### LaneRegistry

| Error | Cause |
| --- | --- |
| `InvalidLane()` | Lane is `None` or above `Control` |
| `ZeroKey()` | Zero address as key |
| `LaneOccupied(Lane)` | The lane already has an active key; rotate instead |
| `KeyAlreadyUsed(address)` | The key was used before; keys are never reused |
| `KeyNotActive(address)` | Revoking or rotating an inactive key |
| `OwnableUnauthorizedAccount(address)` | Caller is not the owner |

### MemoryAnchor

| Error | Cause |
| --- | --- |
| `NotSubmitter()` | Only control's submitter key may anchor |
| `BadAccount()` | Wrong account id |
| `BadMemory()` | Zero id; lane or kind out of range; body over 8,192 bytes; `refBlock` in the future; empty CID |
| `AlreadyAnchored()` | The id is anchored already |
| `UnknownSigner()` | Signature does not recover, or the signer is not a lane key |
| `KeyRevoked()` | The signer's key was revoked |
| `LaneMismatch()` | The signer is bound to another lane |
| `BatchSize()` | Batch empty, over 20, or array lengths differ |

### TyrellLedger

| Error | Cause |
| --- | --- |
| `WrongLane(address signer)` | Not signed by the active key of the required lane (user or control) |
| `Expired()` | Past the signed deadline |
| `StaleNonce(uint256 nonce, uint256 lastUsed)` | Nonce not above the signer's last nonce (replay) |
| `BadPayee()` | Zero id, address or token; zero `capPerTx`; `capPerDay < capPerTx`; label empty or over 64 bytes |
| `PayeeExists(bytes32)` | The payee id is taken |
| `UnknownPayee(bytes32)` | No such payee |
| `PayeeNotActive(bytes32)` | Removing an inactive payee |
| `BadSeed()` | Invalid seed type, zero value, empty reason, or a bad block range |
| `UnknownSeed(uint256)` | No such seed, or not active when suspending a payee |
| `SeedReleased(uint256)` | Releasing a seed twice |

### GuardedVault

| Error | Cause |
| --- | --- |
| `NotPayable(bytes32 code)` | `UNKNOWN_PAYEE`, `PAYEE_REMOVED`, `PAYEE_SUSPENDED`, `ASSET_MISMATCH`, `ZERO_AMOUNT`, `OVER_CAP`, `OVER_DAILY_CAP` or `OVER_GLOBAL_DAILY_CAP` |
| `BadDecision()` | Zero or already paid decision id |
| `ZeroAddress()` | Zero address where one is required |
| `EnforcedPause()` | The vault is paused |
| `AccessControlUnauthorizedAccount(address, bytes32)` | Caller lacks the role (for example a non-signer calling `pay`) |

## Control refusals

Control rejects an envelope before anchoring when:

| Message | Cause |
| --- | --- |
| `between 1 and 20 envelopes per batch` | Batch size out of range |
| `malformed envelope: …` | Schema validation failed |
| `wrong account` | Header account differs from the deployment's |
| `refBlock is in the future` | More than two blocks ahead of control's head |
| `bodyLen does not match body` | Byte length mismatch |
| `signer 0x… is not the active <lane> key` | The signature is not from the active key of the claimed lane |
| `only the control lane writes payment decisions` | A decision envelope from another lane |

Control also refuses requests on `control.sock` that must be signed (`propose`, `incident`, and `quarantine` when not a preview):

| Message | Cause |
| --- | --- |
| `unsigned request: control accepts this only signed by a lane key` | No `auth` on the request |
| `request expired` / `request expiry too far ahead` | The expiry is past, or more than about two minutes ahead |
| `request signature does not match its sender` | The signature does not recover to `auth.by` |
| `request replayed` | The nonce was used before |
| `0x… is not the active <lane> key` | Signed by a key that is not the active key of a lane allowed for this request |

## Signer refusals

| Message | Cause |
| --- | --- |
| `malformed pay request` | Schema validation failed |
| `pay request expired` | Past the request's deadline (60 seconds after control signed it) |
| `agent id does not match this deployment` | The request's agent id is not this deployment's agent |
| `request not signed by the active control key (got 0x…)` | Not from control |
| `decision already paid` / `decision already paid on-chain` | Replay of a decision id |
| `simulation failed: …` | The exact `pay` call would revert now |
| `pay transaction 0x… reverted` | The transaction was sent but reverted |

A refusal becomes the decision's `payError`.

## CLI errors

| Message | Cause |
| --- | --- |
| `no config at …: run tyrell setup keys first` | No `config.json` |
| `no deployment at …: run tyrell deploy first` | No deployment file |
| `no passphrase file for the <role> key at … (chmod 600)` | Missing passphrase file |
| `the <role> key would be opened with the shared passphrase …; on <network> each role needs its own: …` | Testnet or mainnet with only the shared `pass` file: write `pass.d/<role>` or set `KEYSTORE_PASSPHRASE_FILE_<ROLE>` |
| `<what> … is accessible to other users (mode …): chmod 600 it` | A key, passphrase or token file other users can read |
| `the <process> process may not hold the <role> key (I-12)` | A process tried to load a foreign key |
| `<process> can open keys that are not its own: …` | The process can read another role's key and passphrase: on testnet and mainnet always, on a local chain with `TYRELL_STRICT_KEYS=1` |
| `this keystore has no role MAC (written by an older Tyrell): run tyrell keys migrate` | A keystore from before the role MAC |
| `this file holds the <role> key, not <role>` | A keystore used for the wrong role |
| `the role tag of this keystore was changed: it was not written for <role>` | A keystore whose role tag was edited |
| `scrypt parameters too costly (…); refusing to derive` | A keystore asking for more than n = 2^18, r = 16, p = 4 or 256 MB |
| `TYRELL_SCRYPT_N=… is below the minimum 16384; …` | `setup keys` off a local chain with a weak scrypt cost |
| `pass --reason <text> (or --reason-cid <cid>)` | `tyrell release` without a reason |
| `PINATA_JWT is not set` | Pinata store without a JWT |
| `set FORTYTWO_API_KEY (Fortytwo, Qwen), or LLM_BASE_URL, LLM_API_KEY and LLM_MODEL (any OpenAI-compatible endpoint)` | `tyrell steward` without a model |
| `on QIE mainnet the token must be QUSDC (0x3F43…5DA5)` | `tyrell deploy` on mainnet with a `--token` other than QUSDC (leave it out: mainnet defaults to QUSDC) |
| `pass --account <foundry keystore name>` | `tyrell deploy` without a deployer |
| `--unlocked-sender is for local chains only` | Wrong network |
| `--mint only works with the testnet TyrellTestUSD token` | `setup register --mint` with a real token |
| `lane <role> already has key 0x…: rotate it with tyrell revoke --rotate` | `setup register` found a different active key |
| `pass exactly one of --source, --memory, --signer-window, --turn` | `tyrell quarantine` seed options |
| `not a terminal: pass --yes to confirm` | Non-interactive quarantine |
| `control is running: stop it first, or pass --out <path>` | `rebuild` would replace the live database |
| `register a payee first (tyrell payee add)` | `attack run` with no active payee |
| `fund the attacker 0x… with a little gas` | `attack run` on QIE without attacker gas |

### Payee rejections

| Message | Cause |
| --- | --- |
| `label: 1-64 letters, digits, space, _ . -` | Invalid label |
| `pass --qie-id or --address` | No recipient given |
| `<name> does not resolve to an address` | QIE ID has no record |
| `<name> resolves to 0x…, but 0x… reverse-resolves to …: not registering` | QIE ID round-trip failed |
| `confirmation does not match the address` | Wrong last six characters |

## Agents network errors

`AgentRegistry`, `AgentNetwork`, `TestQieId` and the `GuardedVault.payForAgent` additions are listed in [Agents network contracts](/docs/reference/contracts-agents#errors), with the registry codes and message verification codes.
