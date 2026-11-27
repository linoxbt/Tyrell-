---
title: FAQ
description: Short answers to common questions about Tyrell's trust model, payments, quarantine, keys, AI and the web console.
---

## General

### What is Tyrell?

A provenance and quarantine layer for AI-agent memory on QIE. It signs, anchors and traces everything an agent reads, and enforces payments with smart contracts so that no payment depends on the model behaving. See [Introduction](/docs/get-started/introduction).

### Does Tyrell trust the model?

No. The model is treated as untrusted code. Context labels help it behave, but every guarantee holds if it ignores them: it can only propose payments, and code decides.

### Which model can I use?

Any OpenAI-compatible chat completions endpoint with tool calling, set with `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`. See [Steward agent](/docs/guides/steward-agent).

### Why QIE?

Tyrell needs cheap, fast, final writes for every memory anchor, and contracts that re-check payments. On QIE an anchor costs well under a thousandth of a QIEV3 and blocks arrive every few seconds. Tyrell also builds on QIE Wallet (the owner key), QIE ID (payees) and the QIE MCP server.

## Payments

### Can the agent pay an address it read in a token name?

No. The policy engine pays only payees registered with a user-lane signature, and `GuardedVault` checks the same on-chain. The attempt is blocked with `UNKNOWN_RECIPIENT` and recorded as a decision.

### What if the vault signer key leaks?

It can only pay payees you registered, within per-payee and vault-wide daily caps. The worst case is one day's capped spend to legitimate payees, never to an attacker. `tyrell drill signer-leak` demonstrates the vault reverting an unauthorised payment.

### What is the most I can lose in a day?

`min(vault-wide daily cap, sum of active payees' daily caps, vault balance)`, and only to registered payees, whatever happens to every key except the owner's. `tyrell check caps --max <units>` computes it.

### What if QIE RPCs disagree?

Payments fail closed. Rule R0 needs two endpoints that agree on chain and ledger state, spend figures for today, and a verified context before anything is allowed.

### Are QIE IDs resolved when paying?

No. A QIE ID is resolved once, when you add the payee, and must reverse-resolve to the same name. From then on the payee is an exact address on-chain.

### Can I pause everything?

Yes. `GuardedVault.pause()` from QIE Wallet or with the control key stops all payments. Only the owner can unpause. The owner can also `withdraw` the funds at any time.

## Memory and quarantine

### What happens to quarantined memories?

They leave the model's context and the policy engine's inputs at once, and anything written from them later is excluded too. They stay anchored, pinned and readable for forensics. Only your user key releases a seed.

### Can a summary hide where information came from?

No. Every memory the agent read in a turn becomes a parent of what it writes, set by the runtime. A summary of a summary of a poisoned token name is still `untrusted`. Citations are display-only.

### Is anything ever deleted?

No. There is no delete or unpin path. Quarantine is exclusion, and quarantined memories stay readable with `tyrell show <id> --forensic` and in the console.

### Who can see memory contents?

Bodies are encrypted with AES-256-GCM before they reach IPFS, so only holders of the data key can read them. The chain holds only hashes, signers and CIDs. The web console shows decrypted bodies, so serve it only to people allowed to read the agent's memory.

## Keys and recovery

### What if a lane key is stolen?

Revoke it from QIE Wallet (`tyrell revoke --lane <lane>`, or the console's Account tab). `MemoryAnchor` refuses anything it signs from then on. Rotate with `--rotate`, and seed a `signer-window` quarantine to exclude what it wrote while compromised.

### Can I rebuild without your server?

Yes. With the data key, the account id and the contract addresses, `tyrell rebuild --fresh` reconstructs everything from QIE and IPFS, and `tyrell verify` compares digests. There is no Tyrell server.

### What if I lose the data key?

The projection can no longer be rebuilt from IPFS, because bodies cannot be decrypted. Back it up offline.

## AI

### Is Tyrell AI-powered?

Yes, where AI helps and cannot hurt. An optional AI judge reads everything that lands in the agent's wallet and flags manipulation that rules miss, with a reason you can read. It can only raise alarms. What gets paid is decided by code and the chain, so a fooled model can never move money. See [AI sentinel](/docs/guides/ai-sentinel).

### Does the AI judge see my memories?

No. It sees only incoming on-chain text: token names and symbols, and NFT metadata, which are already public.

## Web console and wallet

### Does the hosted console connect to my agent?

No. The hosted demo serves a recorded snapshot. To see your own agent live, run the web app next to control with `TYRELL_API_URL=http://127.0.0.1:7878`.

### Why connect a wallet to the console?

To prove you are the owner and act as owner from the browser: see your role, the four lane keys, and revoke a key in an emergency. Connecting shares only your address; signing in is a free message, not a transaction.

### Which wallets work?

QIE Wallet first, any browser wallet over EIP-6963, and, when the site has a Reown project id, mobile wallets over WalletConnect. See [Web console and wallet](/docs/guides/web-console-and-wallet).

## Many agents

### Can one person run several agents?

Yes. The [agents network](/docs/agents/overview) extends Tyrell to many agents under one human, each bound to the human's QIE ID, with shared quotas and per-agent limits.
