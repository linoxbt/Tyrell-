# Security

Tyrell assumes some poison gets in and makes the guarantees hold anyway. The language model is
treated as untrusted code: no guarantee below depends on it behaving.

## Threat model

| Attacker can | Example | What stops it |
| --- | --- | --- |
| Put text in front of the agent | token names, NFT metadata, transfers, MCP results, pasted web text | Written through the wallet lane first; `untrusted` class; labelled `[UNTRUSTED EXTERNAL]`; taint follows every summary (I-3) |
| Persuade the model to pay them | "SYSTEM NOTE: landlord moved" | The policy engine pays only registered payees within caps (I-5); the vault re-checks on-chain |
| Launder poison through summaries | summary of a summary, citing only clean memories | parents = readSet, set by the runtime; citations are display-only (I-3) |
| Poison addresses | zero-value or dust transfers from a look-alike of a payee | Payees are exact addresses registered by the human; look-alike detection raises incidents |
| Forge a memory | an envelope claiming the user lane | EIP-712 signature must recover to the active key of the claimed lane, checked by control and by MemoryAnchor (I-1) |
| Swap a body on IPFS | re-pin different bytes | AES-GCM with acct and id as AAD, plus body hash and struct hash anchored on-chain (I-2) |
| Steal a lane key | the wallet key leaks | Owner revokes or rotates it in LaneRegistry; MemoryAnchor refuses it from then on (I-9) |
| Steal the vault signer key | send `pay` directly | The vault pays registered payees within per-payee and vault-wide daily caps only (I-5); worst case is one day's capped spend to legitimate payees |
| Front-run an anchor | resubmit a pending envelope with a junk CID | Only control's submitter address may anchor (fix from the spec review) |
| Make control lie to the signer | a request not from control | The signer accepts only requests signed by the active control lane key, re-simulates, and pays each decision id once |

Out of scope: a compromised owner wallet (it is the root of trust), a compromised machine running
every process as one user, and denial of service against QIE RPCs or IPFS gateways (Tyrell fails
closed: no payment without two agreeing endpoints).

## Invariants

| ID | Invariant | Enforced by | Tests |
| --- | --- | --- | --- |
| I-1 | A memory's lane is the lane of the key whose EIP-712 signature verifies | `MemoryAnchor._laneSigner`, `verifyMemory` step 5 | T-03 (Foundry, anvil e2e), `testFuzz_onlyActiveLaneKeysAnchor`, attack 9 |
| I-2 | Default deny: anything unverifiable is `unverified` and authorises nothing | `verifyMemory` (16 reasons), `computeProjection` | verifier.test.ts (100% branches), T-05 |
| I-3 | Taint is monotonic; the runtime sets parents = readSet | `Steward.tool` (write_note, propose), `computeProjection` | T-06, T-07, attack 10 |
| I-4 | The model cannot mint trust | Only the human CLI holds the user key; Steward holds the agent key | `say` CLI test, attack 9 |
| I-5 | Payments are authorised by code, twice | `evaluatePayment` R0-R5; `GuardedVault.pay` | T-10 table, T-11, `invariant_outflowOnlyToRegisteredPayees`, attack set |
| I-6 | Fail closed | R0: two endpoints must agree, spend figures must be for today, context must be verified | policy.test.ts R0 cases |
| I-7 | Exclusion, not deletion | No unpin or delete path; quarantined memories stay readable in forensic mode | nfr07.test.ts, loop test |
| I-8 | Quarantine closure is live | Seeds applied at projection time, in anchor order | T-08, loop test |
| I-9 | Revocation is independent of quarantine | Separate contracts and commands | T-04, T-17 |
| I-10 | Restore is deterministic | `rebuildFresh` shares the projection code with the live process | T-14 (control, CLI, M1, loop), NFR-03 |
| I-11 | The ledger is on-chain, with per-action signer lanes | `TyrellLedger._consume` | TyrellLedger.t.sol, T-16 |
| I-12 | Keys are separated | One keystore per role, tagged; `account()` refuses foreign roles; `TYRELL_STRICT_KEYS=1` aborts if a process can read another role's file | storage tests, CLI key-leak test |

## Known limitations

- **One OS user in the demo.** I-12 is fully enforced only when each process runs as its own OS user
  (then `TYRELL_STRICT_KEYS=1`). In a single-user demo, a process could read another role's file;
  Tyrell warns at startup.
- **Both R0 endpoints come from QIE.** rpc1-5 are run by the same operator, so "two agreeing endpoints"
  guards against a flaky or lagging node, not a malicious operator. On 2026-11-26 testnet rpc1-3 were
  down (PROBE.md). The explorer's `/api/eth-rpc` is excluded because it is a partial proxy.
- **Metadata fetch and DNS rebinding.** Hostnames are resolved and checked against private ranges
  before the fetch, but the fetch resolves again. A rebinding attacker could reach an internal address
  between the two; the response is still only stored as untrusted text.
- **QIE ID resolution uses the QIE MCP server on mainnet**, once, at registration, with a required
  reverse round-trip. A compromised MCP server could return a wrong address for a name it also
  reverse-maps; the human confirms the last six characters before signing.
- **The data key** decrypts every body. Losing it means the projection cannot be rebuilt; leaking it
  exposes memory contents (not integrity: forging still needs a lane key and an anchor).
- **Detection is heuristic.** Scores propose quarantines; they do not protect payments. A split
  instruction can score below the threshold in its second half (attack 4), and payments are still
  blocked by the policy engine.
- **The AI sentinel is a detector, not a guard.** Its score is combined as max(rules, AI), so it can
  only add incidents; a fooled, jailbroken or offline judge costs a missed early warning, never a
  payment. The untrusted text is fenced and the system prompt is fixed, but a model can still be
  persuaded to call poison benign: that is why it cannot lower the rule score. Running the judge on a
  different model from Steward's means an attacker has to fool both. Judging sends incoming on-chain
  text (already public) to the configured model provider.
- **Incidents are local.** They live in control's cache and are not rebuilt from the chain.
- **Refresh cost.** Control re-reads events from the deployment block on each refresh; fine for a
  hackathon-sized history, not for years of memories.
- **OpenZeppelin is pinned to 5.4.0** because 5.5 and later use `mcopy` (Cancun), which QIE's EVM
  does not support (probe P-4).

## Reporting

Open a private security advisory on the repository, or contact the maintainer listed on the
submission form. Do not test against mainnet deployments you do not own.
