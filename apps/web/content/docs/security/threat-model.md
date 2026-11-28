---
title: Threat Model
description: Who Tyrell defends against, what each attacker can do, what stops them, and what is out of scope.
---

Tyrell assumes some poison gets in and makes the guarantees hold anyway. The language model is treated as untrusted code: no guarantee depends on it behaving. This page lists the attackers Tyrell is designed for and the mechanism that stops each one.

## Assets

| Asset | Why it matters |
| --- | --- |
| The vault's tokens | The agent pays real bills from it |
| The agent's memory | What the agent believes decides what it proposes |
| The payee list | Who may be paid at all |
| Lane keys | Who may write which kind of memory |
| The data key | Confidentiality of memory bodies |

## Trust boundaries

| Party | Trusted for |
| --- | --- |
| The owner's QIE Wallet | Everything: it is the root of trust |
| The human CLI (user key) | Your statements, payees, quarantine releases |
| Control | Verifying and anchoring; it cannot add payees or release quarantines |
| The signer | Calling `pay`; it cannot choose whom to pay |
| Steward (the model) | Nothing |
| Anything external: tokens, NFTs, transfers, MCP results, web text | Nothing |

## Attackers and defences

| Attacker can | Example | What stops it |
| --- | --- | --- |
| Put text in front of the agent | Token names, NFT metadata, transfers, MCP results, pasted web text | Written through the wallet lane first; classed `untrusted`; labelled `[UNTRUSTED EXTERNAL]`; taint follows every summary (I-3) |
| Persuade the model to pay them | "SYSTEM NOTE: landlord moved" | The policy engine pays only registered payees within caps (I-5); the vault re-checks on-chain |
| Launder poison through summaries | A summary of a summary, citing only clean memories | parents = readSet, set by the runtime; citations are display-only (I-3) |
| Poison addresses | Zero-value or dust transfers from a look-alike of a payee | Payees are exact addresses registered by the human; look-alike detection raises incidents |
| Spoof a label | `landIord` with a capital i, or an invisible character | Labels compare after trim and ASCII lower-case only: `LABEL_MISMATCH` |
| Substitute a token | A fake contract named `QUSDC` | The token address must equal the payee's token: `ASSET_MISMATCH` |
| Forge a memory | An envelope claiming the user lane | The EIP-712 signature must recover to the active key of the claimed lane, checked by control and by `MemoryAnchor` (I-1) |
| Swap a body on IPFS | Re-pin different bytes under a CID | AES-GCM with account and id as AAD, plus body hash and struct hash anchored on-chain (I-2) |
| Steal a lane key | The wallet key leaks | The owner revokes or rotates it in `LaneRegistry`; `MemoryAnchor` refuses it from then on (I-9); a `signer-window` seed excludes what it wrote |
| Steal the vault signer key | Send `pay` directly | The vault pays registered payees within per-payee and vault-wide daily caps only (I-5); the worst case is one day's capped spend to legitimate payees |
| Front-run an anchor | Resubmit a pending envelope with a junk CID | Only control's submitter address may anchor (`NotSubmitter`) |
| Make control lie to the signer | A pay request not from control | The signer accepts only requests signed by the active control lane key, before their 60-second deadline, re-simulates, and pays each decision id once |
| Drive control from another local process | A process on the machine writes to `control.sock` | Proposals must be signed by the agent key, incidents by the wallet key, quarantines by the user key (the wallet key only for source seeds), each with a nonce and a two-minute expiry; replays are refused |
| Hide what the model read | A proposal with an empty or partial read set | Control adds every memory it served to the turn to the decision's parents |
| Forge a payment decision | An agent-lane memory dressed as an `ALLOW, paid` decision | Decision records are accepted only from the control lane; anything else is `unverified` (`DECISION_NOT_CONTROL`) |
| Pay without a record | A turn that read more than a record can cite | The decision is anchored before the signer is asked; a turn over 64 memories is blocked; a lost signer answer blocks the payee until the chain settles it |
| Read decrypted memories from a web page | DNS rebinding against control's view API | Loopback `Host` only and a bearer token (`TYRELL_HOME/api-token`) |
| Replay a ledger action | Resubmit an old `AddPayee` or release | Per-signer strictly increasing nonces and deadlines (`StaleNonce`, `Expired`) |
| Feed stale or forked state | A lagging or lying RPC | Two different endpoints must agree on the head hash and every field of the whole history and ledger state; a third breaks a tie; otherwise R0 blocks (`CHAIN_INCONSISTENT`) |
| Stop the sentinel | A transfer with malformed data or a broken token URI | Each event is handled on its own; an undecodable one becomes an observation, and the scan position advances per window |
| Steal keys from a file | Relabel or swap a key file, or plant one with huge scrypt cost | Role bound into the keystore MAC; mode 600 required; scrypt parameters capped before deriving |
| Exploit the metadata fetcher | `tokenURI` pointing at an internal service | `data:`, `https:` and `ipfs:` only; 64 KB, 5 s, no redirects; private and loopback addresses refused |
| Fool the AI judge | Text crafted to be classed benign | The judge can only raise a score, never lower it; payments never read it |

## Compromise scenarios

What an attacker gets by compromising one component, and nothing else:

| Compromised | Attacker can | Attacker cannot |
| --- | --- | --- |
| The model | Propose anything, write agent notes | Write trusted memories, pay anyone not registered, exceed caps |
| The wallet (ingest) key | Write untrusted observations, report incidents, seed source quarantines | Write trusted or derived memories, release quarantines |
| The agent key | Write agent notes (classed by their parents), start a turn and propose payments | Pay anyone not registered, exceed caps, add payees, write trusted memories, forge a decision |
| The control key | Seed quarantines, suspend payees, pause the vault, sign pay requests | Add or reinstate payees, release quarantines, pay anyone not registered, exceed caps |
| The signer key | Call `pay` | Pay anyone not registered, exceed caps, reuse a decision |
| The submitter key | Anchor validly signed envelopes | Forge a lane signature |
| The data key | Read memory bodies | Forge memories (needs a lane key and an anchor) |
| The user key | Add payees, write trusted memories | Exceed the vault-wide daily cap set by the owner |

The owner can respond to any of these from QIE Wallet: revoke or rotate the key, pause the vault, or withdraw the funds.

## Worst case

With every key except the owner's compromised, the most the vault can lose in one UTC day is:

```text
min(vault-wide daily cap, sum of active payees' daily caps, vault balance)
```

and only to payees the human registered. `tyrell check caps --max <units>` computes it and fails if it is above your limit. Fund the vault only after it passes.

## Out of scope

- **A compromised owner wallet.** It is the root of trust.
- **A compromised machine running every process as one user.** Key separation (I-12) is fully enforced only with one OS user per process, each owning its own key and passphrase files; on testnet and mainnet a process that could open another role's key refuses to start.
- **Denial of service** against QIE RPCs or IPFS gateways. Tyrell fails closed: no payment without two agreeing endpoints, and unavailable bodies make memories `unverified`.

See [Invariants](/docs/security/invariants) for how each guarantee is enforced and tested, and [Known limitations](/docs/security/limitations) for the residual risks.

## Reporting

Open a private security advisory on the repository, or contact the maintainer listed on the submission form. Do not test against mainnet deployments you do not own.
