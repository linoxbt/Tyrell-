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
| Make control lie to the signer | a request not from control | The signer accepts only requests signed by the active control lane key, before their 60 s deadline, re-simulates, and pays each decision id once |
| Drive control from another local process | write to `control.sock` | `propose` must be signed by the agent key, `incident` by the wallet key, `quarantine` by the user key (wallet key: source seeds only), with nonce and 2-minute expiry; replays refused |
| Hide what the model read | a proposal with an empty read set | Control adds every memory it served to the turn to the decision's parents |
| Forge a payment decision | an agent-lane "ALLOW, paid" record | Decisions are accepted only from the control lane (`DECISION_NOT_CONTROL`) |
| Pay without a record | a turn that read more than 64 memories, or a lost signer answer | The decision is anchored before the signer is asked; over-64 turns are blocked; an unsettled payment blocks its payee until the chain settles it |
| Feed forged history | a lying RPC adds a lane key or drops events | Two different endpoints compared on every field of the whole history and the head hash; a third breaks ties; otherwise `CHAIN_INCONSISTENT` and R0 blocks |
| Read memories from a web page | DNS rebinding against control's view API | Loopback `Host` only, plus a bearer token (`TYRELL_HOME/api-token`) |
| Stop the sentinel | a malformed Transfer event or token URI | Per-event handling (an "undecodable" observation), byte-safe truncation, scan position saved per window |

Out of scope: a compromised owner wallet (it is the root of trust), a compromised machine running
every process as one user, and denial of service against QIE RPCs or IPFS gateways (Tyrell fails
closed: no payment without two agreeing endpoints).

## Invariants

| ID | Invariant | Enforced by | Tests |
| --- | --- | --- | --- |
| I-1 | A memory's lane is the lane of the key whose EIP-712 signature verifies | `MemoryAnchor._laneSigner`, `verifyMemory` step 5 | T-03 (Foundry, anvil e2e), `testFuzz_onlyActiveLaneKeysAnchor`, attack 9 |
| I-2 | Default deny: anything unverifiable is `unverified` and authorises nothing | `verifyMemory` (17 reasons), `computeProjection` | verifier.test.ts (100% branches), T-05 |
| I-3 | Taint is monotonic; the runtime sets parents = readSet | `Steward.tool` (write_note, propose), `computeProjection` | T-06, T-07, attack 10 |
| I-4 | The model cannot mint trust | Only the human CLI holds the user key; Steward holds the agent key | `say` CLI test, attack 9 |
| I-5 | Payments are authorised by code, twice, and always recorded first | `evaluatePayment` R0-R5; `GuardedVault.pay` / `payForAgent`; `Payments.decide` anchors the decision before paying | T-10 table, T-11, `invariant_outflowOnlyToRegisteredPayees`, attack set |
| I-6 | Fail closed | R0: two endpoints must agree on the full history (third breaks ties), spend figures must be for today, context must be verified | policy.test.ts R0 cases |
| I-7 | Exclusion, not deletion | No unpin or delete path; quarantined memories stay readable in forensic mode | nfr07.test.ts, loop test |
| I-8 | Quarantine closure is live | Seeds applied at projection time, in anchor order | T-08, loop test |
| I-9 | Revocation is independent of quarantine | Separate contracts and commands | T-04, T-17 |
| I-10 | Restore is deterministic | `rebuildFresh` shares the projection code with the live process | T-14 (control, CLI, M1, loop), NFR-03 |
| I-11 | The ledger is on-chain, with per-action signer lanes | `TyrellLedger._consume` | TyrellLedger.t.sol, T-16 |
| I-12 | Keys are separated | One keystore and passphrase per role (`pass.d/<role>`), role bound into the MAC; mode 600 required; `account()` refuses foreign roles; off a local chain a process that can open another role's key aborts; IPC requests signed by the right lane key | storage tests, CLI key-leak test, requestAuth tests |

## Known limitations

- **One OS user in the demo.** I-12 is fully enforced only when each process runs as its own OS user
  owning only its own key and passphrase files. On testnet and mainnet a process that could open
  another role's key refuses to start; on a local chain it warns (`TYRELL_STRICT_KEYS=1` aborts), and
  `TYRELL_INSECURE_SHARED_KEYS=1` deliberately turns the checks off.
- **A compromised agent key can start a turn.** Proposals are signed by the agent key, so whoever holds
  it can propose payments; the policy engine and the vault still pay only registered payees within caps.
- **Lane keys can be created in the browser (deliberate exception to NFR-01).** The console's Account
  tab can create a new lane key for the owner. The secret is generated and encrypted in the page
  (keystore v3 with the role MAC); only the encrypted file leaves it, as a download, and the password
  is never stored or sent. The key exists briefly in the tab's memory, where a malicious extension could
  read it; owners who mind use "Use a key I already have" with an address from `tyrell setup keys`.
- **Both R0 endpoints come from QIE.** rpc1-5 are run by the same operator, so "two agreeing endpoints"
  guards against a flaky, lagging or tampered node (compared on the whole history), not a malicious
  operator. On 2026-11-26 testnet rpc1-3 were
  down (PROBE.md). The explorer's `/api/eth-rpc` is excluded because it is a partial proxy.
- **Metadata fetch and DNS rebinding.** Hostnames are resolved and checked against private ranges
  before the fetch, but the fetch resolves again. A rebinding attacker could reach an internal address
  between the two; the response is still only stored as untrusted text.
- **QIE ID resolution uses the QIE MCP server on mainnet**, once, at registration, with a required
  reverse round-trip. A compromised MCP server could return a wrong address for a name it also
  reverse-maps; the human confirms the last six characters before signing.
- **QIE ID binding trusts QIE's record store.** AgentRegistry reads the upgradeable proxy at
  `0x8777…5018` on every check. Whoever can upgrade that proxy can change who holds a name, and so
  which human an agent answers to. A revert or a zero address counts as unbound (fail-closed). QIE ID
  is not on testnet, so testnet deployments use `TestQieId`, which anyone can claim names in.
- **The arbiter is trusted** for contested abuse reports: only its rulings slash bonds or ban agents
  (an uncontested report only refunds the reporter's bond and costs the agent reputation). A contested
  report it does not rule on in time lapses with both bonds refunded; the council can replace it. Use
  multisigs as arbiter and council on mainnet.
- **Reputation is a score, not a guarantee.** It is computed from deals, bond and penalties on-chain;
  deals must be between agents of different humans, and each one is paid from the payer's limits and
  shared quota, so farming reputation costs real funds and a second bound QIE ID.
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
- **The website's Live AI demo** calls the model provider from the site's server with the site
  owner's key. Visitors' attack text (at most 280 characters) is sent to the provider. Runs are
  rate-limited per visitor and per minute, and presets are cached, but those counters are per server
  instance: set a spend limit on the key. The demo never touches a real chain or real funds.
- **Incidents are local.** They live in control's cache and are not rebuilt from the chain.
- **Refresh cost.** The first refresh reads the whole history on two endpoints; later ones read only new
  blocks once the last cross-checked block is confirmed canonical. Ledger state and blobs are still
  re-read on each refresh.
- **The hosted console is a recording.** Live data means running the console next to control with
  `TYRELL_API_URL` and `TYRELL_API_TOKEN`; the view API serves decrypted bodies and accepts only a
  loopback `Host`, so exposing it remotely needs a Host-rewriting tunnel and should be for demo data only.
  `tyrell snapshot` leaves memory contents out unless `--include-bodies` is passed.
- **OpenZeppelin is pinned to 5.4.0** because 5.5 and later use `mcopy` (Cancun), which QIE's EVM
  does not support (probe P-4).

## Reporting

Open a private security advisory on the repository, or contact the maintainer listed on the
submission form. Do not test against mainnet deployments you do not own.
