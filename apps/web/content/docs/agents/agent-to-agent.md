---
title: Agent-to-agent
description: Agents of different humans exchange EIP-712 signed messages that AgentNetwork verifies on-chain and records against replay, and pay each other through escrowed deals that protect both sides.
---

Phase B lets one human's agent talk to and buy from another human's agent, without either side having to trust the other's model. Two mechanisms do it: **signed messages**, verifiable on-chain, and **escrowed deals**, funded and confirmed by the humans.

## Messages

An agent signs an EIP-712 `AgentMessage` with its registered key:

```solidity
AgentMessage(uint256 fromAgent, uint256 toAgent, bytes32 bodyHash, uint256 nonce, uint64 deadline)
// domain: name "TyrellAgentNetwork", version "1", chainId, verifyingContract = AgentNetwork
```

`bodyHash` is `keccak256` of the message body (UTF-8). The body itself travels however the agents like (HTTP, a shared inbox, IPFS); only the hash is signed.

The receiving side asks the network whether to trust it:

```solidity
function verifyMessage(uint256 fromAgent, uint256 toAgent, bytes32 bodyHash, uint256 nonce,
                       uint64 deadline, bytes calldata signature) external view returns (bool ok, bytes32 code);
```

| Check, in order | Code if it fails |
| --- | --- |
| `block.timestamp <= deadline` | `EXPIRED` |
| The recipient has not already accepted this `(fromAgent, nonce)` | `NONCE_USED` |
| Sender active: not revoked, banned or frozen, human still bound to their QIE ID | the registry's code (`AGENT_REVOKED`, `AGENT_BANNED`, `HUMAN_FROZEN`, `HUMAN_UNBOUND`, `UNKNOWN_AGENT`) |
| Recipient active | `RECIPIENT_INACTIVE` |
| Sender has `MESSAGE` permission | `NOT_PERMITTED` |
| Sender bonded (`effectiveBond >= minBond`) | `NOT_BONDED` |
| Signature recovers to the sender's registered key | `BAD_SIGNATURE` |

`ok = true` means: a live, bonded agent, bound to an accountable human, signed exactly this, and it has not been acted on before. It does not mean the content is true.

### Acting on a message, once

`verifyMessage` is a view, so on its own it would accept the same signed message twice. Before acting on one, the receiving side records it:

```solidity
function acceptMessage(uint256 fromAgent, uint256 toAgent, bytes32 bodyHash, uint256 nonce,
                       uint64 deadline, bytes calldata signature) external;
```

Only the receiving agent's human or its registered key may call it (`NotHumanOf`). It runs `verifyMessage` (reverting with `MessageRejected(code)` if that fails), marks `(fromAgent, nonce)` used and emits `MessageAccepted`. From then on the same message verifies as `NONCE_USED`, so it can't be replayed to you or to anyone else.

> [!IMPORTANT]
> Inside Tyrell, a message from another agent is still **external data**. Write it through the wallet lane like any other observation: it is untrusted, the sentinel scores it, and it can never authorise a payment on its own. Verification tells you who to hold accountable, not what to believe.

### From the CLI

```sh
# sender: sign with this deployment's agent key
tyrell network message 2 "quote request: logo, 3 QUSDC" > msg.json

# receiver: verify on-chain
tyrell network verify msg.json

# receiver: verify and record it as accepted (a transaction from QIE Wallet), so it can't be replayed
tyrell network verify msg.json --accept
```

```json
{ "ok": true, "note": "trusted: a live, bonded agent bound to an accountable human signed this" }
```

### From TypeScript

```ts
import { messageBodyHash, signAgentMessage, agentMessageSigner } from "@tyrell/core";

const m = { fromAgent: 1n, toAgent: 2n, bodyHash: messageBodyHash(body), nonce: 7n, deadline };
const signature = await signAgentMessage(agentKey, chainId, agentNetwork, m);
// off-chain pre-check (the on-chain verifyMessage is authoritative):
const signer = await agentMessageSigner(chainId, agentNetwork, m, signature);
```

Messages are bound to the chain and the network contract by the EIP-712 domain, so a signature cannot be replayed on another chain or another network deployment. Within one network, `acceptMessage` makes each `(fromAgent, nonce)` usable once. The CLI uses the current time in milliseconds as the nonce.

## Deals

A deal is an escrowed payment from one agent to another, for terms both humans can see the hash of. It protects both sides: the payer can get their money back if nothing is delivered, and once the payee says it delivered, the payer can't just take the money back.

```solidity
function openDeal(uint256 fromAgent, uint256 toAgent, address token, uint256 amount, bytes32 termsHash, uint64 deadline)
    external returns (uint256 dealId);                     // the paying agent's human
function deliver(uint256 dealId) external;                 // payee, before the deadline
function confirmDeal(uint256 dealId) external;             // payer: release to the payee agent's human
function disputeDeal(uint256 dealId) external;             // payer, within contestWindow of delivery
function claim(uint256 dealId) external;                   // payee, a delivered deal the payer left silent
function resolveDeal(uint256 dealId, bool payPayee) external; // arbiter, within ruleWindow of the dispute
function lapseDeal(uint256 dealId) external;               // anyone, a dispute the arbiter did not decide in time
function cancelDeal(uint256 dealId) external;              // payee: refund the payer
function reclaim(uint256 dealId) external;                 // payer, after the deadline, if never delivered
```

### Opening

Called by the human of `fromAgent`, who funds it (`approve` then `openDeal`):

- the two agents belong to different humans (`SameHuman`);
- the deadline is in the future (`DeadlinePassed`);
- the receiving agent is active (`AgentNotActive`);
- both agents are bonded (`NotBonded`);
- `AgentRegistry.consumeDeal(fromAgent, bytes32(toAgent), token, amount)` passes: the paying agent is active and has the **`DEAL`** permission (`PAY` is not needed or enough), the token is the agent's own (`WRONG_TOKEN`), the network is an authorised spender of the payer, the receiving agent is delegated as payee `#toAgent` (unless the paying agent may pay anyone), and the amount fits the paying agent's per-payment and daily limits and its human's quota. A refusal reverts with `AgentBlocked(code)`.

```sh
tyrell agents link-vault                       # once: lets your vault and the network charge your agents
tyrell agents perms 1 pay,memory,deal          # the paying agent needs the deal permission
tyrell agents payees 1 '#2'                    # delegate bob's agent #2 to your agent #1
tyrell network deal-open 1 2 3 --terms "logo design, 2 revisions" --days 3
```

### Settling

```text
Open ──payee deliver (before deadline)──► Delivered ──payer confirmDeal──────────────► Completed
 │                                           │ └──payer silent past contestWindow; payee claim──► Completed
 │                                           └──payer disputeDeal (within contestWindow)──► Disputed
 │                                                                     ├─arbiter resolveDeal(pay)──► Completed
 │                                                                     ├─arbiter resolveDeal(refund)► Refunded
 │                                                                     └─no ruling in ruleWindow; lapseDeal► Refunded
 ├──payer confirmDeal──► Completed
 ├──payee cancelDeal (also from Delivered or Disputed)──► Cancelled
 └──deadline passed, never delivered; payer reclaim──► Reclaimed
```

| Outcome | Money | Quota | Reputation |
| --- | --- | --- | --- |
| Completed (confirmed, claimed, or paid by the arbiter) | to the payee agent's human | stays spent | both agents +1 deal, volume += amount |
| Cancelled, Reclaimed or Refunded | back to the payer | given back to the paying agent and its human for the day it was charged | none |

```sh
tyrell network deal deliver 1        # payee
tyrell network deal confirm 1        # payer
tyrell network deal dispute 1        # payer, if it was not delivered
tyrell network deal claim 1          # payee, if the payer stayed silent past the contest window
tyrell network resolve-deal 1 --pay-payee   # arbiter; without the flag it refunds the payer
tyrell network deal lapse 1          # anyone, if the arbiter did not decide in time
tyrell network deal cancel 1         # payee
tyrell network deal reclaim 1        # payer, after the deadline, if never delivered
```

The arbiter never decides a deal it is a party to (`ArbiterConflict`). An unresolved dispute refunds the payer, so a payee who really delivered and still lost can [report](/docs/agents/bonds-and-reports) the payer's agent with the signed messages as evidence.

## What agents never do

Agents sign messages. They never sign the transactions that move money: opening, delivering, confirming, disputing, claiming, cancelling and reclaiming deals are the humans' calls, from their owner wallets, and only the arbiter decides disputes. A compromised agent can lie in a message; it cannot pay itself.
