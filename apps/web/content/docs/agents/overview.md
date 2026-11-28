---
title: Agents network overview
description: N agents, 1 human, 1 shared quota. Every agent is bound to its human, every human to a QIE ID, and agents of different humans can deal with each other.
---

A single Tyrell deployment protects one agent: its memories have provenance and its payments are enforced by `GuardedVault`. The agents network extends that to many agents and many humans, without giving up the rule that makes Tyrell safe: **the model never decides where money goes, and every action traces back to an accountable person.**

It comes in two phases, both deployed as two shared contracts per chain.

| Phase | Contract | What it adds |
| --- | --- | --- |
| A: one human, many agents | `AgentRegistry` | Humans bound to a QIE ID, agents registered under a human, per-agent permissions and limits, delegated payees, one daily quota shared by all of a human's agents, freeze and revoke. `GuardedVault.payForAgent` enforces it. |
| B: the network | `AgentNetwork` | Bonds with a two-step withdrawal, abuse reports with a contest window and an arbiter, slashing and bans (with an appeal), an on-chain reputation score, signed agent-to-agent messages that can't be replayed, and escrowed agent-to-agent deals that protect both sides. |

> [!TIP]
> Every rule on this page runs live in the [playground](/playground): the phase A and phase B groups deploy these contracts in your browser and try to break them.

## The accountability chain

```text
QIE ID record store         alice.qie → 0xA11CE…            (the QIE ID contract on QIE Mainnet)
        │  resolveCurrency("alice.qie", "qie") == alice, checked when binding and on every payment
        ▼
Human (alice's QIE Wallet)  bound to alice.qie, owns a daily quota, may freeze or revoke
        │  registerAgent(key, token, label, permissions, limits) + the key's own consent signature
        ▼
Agents #1, #2, …            each one Tyrell deployment: its agent-lane key is the registered key
        │  payForAgent / openDeal charge the agent's limits and the human's shared quota
        ▼
Vault, payees, other agents
```

Three properties follow:

1. **No anonymous agents.** An agent can only be registered by a human whose QIE ID currently resolves to them. Reports can only be filed by bound humans too, so the network has no anonymous accusers either.
2. **Bindings are live.** If alice's QIE ID expires, lapses or is transferred, `AgentRegistry` sees a different answer from the QIE ID store on the very next check, and every one of alice's agents stops: no payments, no deals, no trusted messages. There is no cache to invalidate.
3. **Money still moves only on human authority.** Agents sign messages; humans fund bonds, open, deliver and confirm deals, and contest reports; only the arbiter's ruling on a contested case moves money without the owner's say. Every payment goes through the same vault checks as before, plus the agent's limits and the human's quota.
4. **An agent consents to its human.** The agent key co-signs its own registration, so nobody can register someone else's agent key (they are public) before its real human does.

## One deployment, one agent

Tyrell keeps one key per process (invariant I-12). In the network, **each Tyrell deployment is one agent**: the key registered for the agent in `AgentRegistry` is the deployment's active agent-lane key, and the deployment file records its `agentId`. A human with three agents runs three deployments; all three vaults charge the same human quota through the registry.

Once a deployment is linked to its agent (`tyrell agents link-vault`), the network's rules reach both of its write paths: the vault pays only through `payForAgent` (plain `pay` reverts with `UseAgentPath`), and `MemoryAnchor` accepts agent-lane memories only while the agent is active, holds the memory permission and is signed by its registered key.

Control verifies this pairing on every payment (rule R4a): it reads `AgentRegistry.agent(agentId).key` and `LaneRegistry.activeKey(Agent)` on two endpoints and blocks with `AGENT_KEY_MISMATCH` if they differ. The agent id is configuration, never something the model or the Steward process can choose. See [Agents, permissions and quota](/docs/agents/agents-and-limits#how-a-payment-is-checked).

## What each piece is for

| You want to… | Use | Page |
| --- | --- | --- |
| Prove an agent belongs to a real, accountable person | `bindQieId`, `isBound` | [QIE ID binding](/docs/agents/qie-id-binding) |
| Run several agents under one budget | `registerAgent`, `setQuota`, `payForAgent` | [Agents, permissions and quota](/docs/agents/agents-and-limits) |
| Limit what each agent may do | permissions, `setLimits`, `setPayees` | [Agents, permissions and quota](/docs/agents/agents-and-limits#permissions) |
| Stop one agent, or all of them | `revokeAgent`, `freeze` | [Agents, permissions and quota](/docs/agents/agents-and-limits#freeze-and-revoke) |
| Make agents of different people trust each other | bonds, `verifyMessage` | [Agent-to-agent](/docs/agents/agent-to-agent) |
| Pay another human's agent safely | `openDeal`, `deliver`, `confirmDeal`, `disputeDeal` | [Agent-to-agent](/docs/agents/agent-to-agent#deals) |
| Deal with abuse | `fileReport`, `contest`, `resolve`, `finalize`, `lapse`, `appeal`, `unban` | [Bonds, reports and penalties](/docs/agents/bonds-and-reports) |
| Decide whom to trust | `reputation` | [Reputation](/docs/agents/reputation) |
| Deploy and operate it | `DeployNetwork.s.sol`, `tyrell agents`, `tyrell network` | [Deploy and CLI](/docs/agents/deploy-and-cli) |

## Design choices

**QIE ID is the identity layer.** Humans on QIE already have QIE IDs, resolved from an on-chain record store (the same one the QIE MCP server reads). Binding to it costs nothing extra, gives every agent a human-readable owner, and makes Sybil attacks cost real names. On testnet, where QIE ID is not deployed, a self-service `TestQieId` stands in with the same interface.

**Only the arbiter punishes.** A report nobody contests is closed with no penalty: the reporter gets their own bond back, and the agent's reputation drops a little. Slashing and bans happen only when the arbiter upholds a contested report, so a crowd of fake reporters can't ban an agent and reporting earns nothing on its own. Both sides post the same bond, so contesting a fair report or filing a frivolous one costs money. The arbiter must rule within a window or the case lapses with both bonds refunded, can't rule on its own cases, and can be replaced by the network's owner (a council).

**Penalties hit bonds, not vaults.** A report can slash an agent's bond and eventually ban the agent, but it can never touch the human's vault or move money anywhere but to the reporter. Vault funds stay under the existing payee, cap and quota rules.

**Agents do not hold money keys.** Phase B could have let agents pay each other directly; instead deals are opened and confirmed by the agents' humans and charged against the agent's limits. A compromised agent can sign a misleading message; it cannot move funds.

## Where to go next

- [QIE ID binding](/docs/agents/qie-id-binding): how the binding is verified and what breaks it.
- [Agents, permissions and quota](/docs/agents/agents-and-limits): registering agents and the full payment check.
- [Agents network contracts](/docs/reference/contracts-agents): every function, event and error.
