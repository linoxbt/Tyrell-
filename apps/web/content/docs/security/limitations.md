---
title: Known Limitations
description: Residual risks and design trade-offs in Tyrell, stated plainly, with what mitigates each one.
---

These are the known limits of the current design. Each is stated with what it means in practice and what mitigates it.

## Key separation needs one OS user per process

Invariant I-12 is fully enforced only when each process runs as its own OS user, so the file system stops one process from reading another role's key file. In a single-user demo, a process *could* read another role's file. Every process checks at startup and warns; set `TYRELL_STRICT_KEYS=1` in production to make a readable foreign key file a hard failure.

## Both R0 endpoints come from QIE

`rpc1` to `rpc5` are run by the same operator, so "two agreeing endpoints" guards against a flaky or lagging node, not a malicious operator. On 2026-11-26, testnet `rpc1` to `rpc3` were down. The explorer's `/api/eth-rpc` is excluded because it is a partial proxy. Adding an independent RPC provider to `config.json` strengthens R0.

## Metadata fetch and DNS rebinding

Hostnames are resolved and checked against private ranges before the fetch, but the fetch resolves again. A DNS-rebinding attacker could make the second resolution reach an internal address. The response is still bounded (64 KB, 5 s, no redirects) and only stored as untrusted text.

## QIE ID resolution trusts the QIE MCP server once

Payees added by QIE ID are resolved through the QIE MCP server on mainnet, once, at registration, with a required reverse round-trip. A compromised MCP server could return a wrong address for a name it also reverse-maps. The human confirms the last six characters of the address before signing, and after registration the payee is an exact address on-chain.

## The data key decrypts every body

Losing the data key means the projection cannot be rebuilt from IPFS. Leaking it exposes memory contents, but not integrity: forging a memory still needs a lane key and an anchor. Back the data key up offline.

## Detection is heuristic

Scores propose quarantines; they do not protect payments. A split instruction can score below the threshold in its second half (attack 4), and the payment is still blocked by the policy engine.

## The AI sentinel is a detector, not a guard

Its score is combined as `max(rules, AI)`, so it can only add incidents. A fooled, jailbroken or offline judge costs a missed early warning, never a payment. The untrusted text is fenced and the system prompt is fixed, but a model can still be persuaded to call poison benign, which is why it cannot lower the rule score. Running the judge on a different model from Steward's means an attacker has to fool both. Judging sends incoming on-chain text, which is already public, to the configured model provider.

## Incidents are local

Incidents live in control's cache and are not rebuilt from the chain. They are hints; quarantine seeds, which are on-chain, are what matter.

## Refresh cost

Control re-reads events from the deployment block on each refresh. That is fine for a hackathon-sized history, not for years of memories; an incremental reader is the next step.

## OpenZeppelin is pinned to 5.4.0

OpenZeppelin 5.5 and later use `mcopy` (a Cancun opcode), which QIE's EVM does not support (probe P-4). The contracts stay on 5.4.0 until QIE supports Cancun.

## The hosted demo is a snapshot

The public web app serves a recorded run. It never connects to a live control process, because control and the signer hold lane keys that must stay on the operator's machine. Run the console with `TYRELL_API_URL` locally for live data.
