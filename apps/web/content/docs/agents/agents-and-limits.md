---
title: Agents, permissions and quota
description: Phase A. Register agents under a QIE-ID-bound human, set permissions and limits, delegate payees, share one daily quota, freeze and revoke.
---

Phase A gives one human many agents, each with its own key, permissions and limits, all drawing on one daily quota. `AgentRegistry` holds the rules; `GuardedVault.payForAgent` and `AgentNetwork.openDeal` enforce them on-chain, and control's policy engine checks them first.

## Registering an agent

The human, bound to a QIE ID, calls:

```solidity
function registerAgent(
    address key,          // the agent's key: a Tyrell deployment's agent-lane key
    string calldata label,// a name for people, e.g. "rent agent"
    bytes32 metaHash,     // hash of a model/operator description (optional)
    uint32 permissions,   // bit flags, see below
    uint128 perTxLimit,   // most the agent may spend at once (token base units)
    uint128 dailyLimit,   // most the agent may spend per UTC day
    bool anyPayee         // false: only delegated payees
) external returns (uint256 agentId);
```

Rules:

- The caller must be bound (`NotBound` otherwise).
- The key must be new: not zero, not the caller, never used before, not a human's address (`BadKey`). Keys are never reused, even after revocation.
- At most `MAX_AGENTS` (64) active agents per human (`TooManyAgents`).
- Agent ids start at 1 and never change.

From the CLI, run in the deployment whose agent-lane key you are registering:

```sh
tyrell agents register --label "rent agent" --per-tx 4 --daily 5 --perms pay
```

Amounts are in token units (the CLI reads the token's decimals). Without `--key`, the deployment's own agent-lane key is registered, and after the transaction is mined the CLI writes `agentId` into the deployment file. From then on this deployment pays through `payForAgent`.

## Permissions

| Bit | Name | Lets the agent… |
| --- | --- | --- |
| `1` | `PAY` | propose payments to the human's payees (`payForAgent`) |
| `2` | `MEMORY` | write memories on the human's behalf (informational; lane keys still gate anchoring) |
| `4` | `MESSAGE` | send agent-to-agent messages that `verifyMessage` will accept |
| `8` | `DEAL` | be the paying side of an agent-to-agent deal |

Change them with `setPermissions(agentId, mask)` or `tyrell agents perms <id> pay,deal`. In TypeScript, `@tyrell/core` exports `PERM`, `permMask` and `permNames`.

## Delegated payees

An agent with `anyPayee = false` may only pay payees the human delegated to it:

```sh
tyrell agents payees 1 landlord,school          # delegate by payee label
tyrell agents payees 1 school --remove         # withdraw
tyrell agents payees 1 '#7'                    # agent 7 as a deal counterparty
tyrell agents any-payee 2 on                   # agent 2 may pay any registered payee
```

Payee ids are the ledger's (`keccak256("payee:" + label)`); a deal counterparty is `bytes32(agentId)` (`dealPayeeId` in `@tyrell/core`). Delegation never adds payees: a delegated payee must still be registered, active and unsuspended in `TyrellLedger`, and the vault still applies its caps.

## Limits and the shared quota

Three spending limits apply to every agent spend, per UTC day (`block.timestamp / 86400`, the same boundary as `GuardedVault`):

| Limit | Set with | Code when exceeded |
| --- | --- | --- |
| Agent per payment | `setLimits(id, perTx, daily)` | `OVER_AGENT_TX_LIMIT` (also for amount 0) |
| Agent per day | `setLimits(id, perTx, daily)` | `OVER_AGENT_DAILY_LIMIT` |
| Human per day, all agents together | `setQuota(token, daily)` | `OVER_HUMAN_QUOTA` |

The quota is per token and **fails closed**: a token with no quota cannot be spent by any agent. For example, with a quota of 6 QUSDC, if agent #1 spends 3, agent #2 can spend at most 3 more today, even if its own daily limit is 4.

```sh
tyrell agents quota 6
tyrell agents limits 1 4 5
```

These limits stack with the vault's own rules (payee caps, the vault-wide daily cap), never replace them.

## Spenders

Only contracts the human authorised can charge their agents:

```solidity
function setSpender(address spender, bool allowed) external;
function consume(uint256 agentId, bytes32 payeeId, address token, uint256 amount) external; // spenders only
```

Authorise your vault (and the network, if your agents will open deals) with:

```sh
tyrell agents link-vault     # setSpender(vault, true) and vault.setAgentRegistry(registry)
```

A vault the human did not authorise gets `NotSpender`. So one human's vault cannot charge another human's agents, and a stranger cannot burn your quota.

## How a payment is checked

When the Steward agent of a registered deployment proposes a payment, three layers check it.

1. **Control: policy engine R0 to R4.** Endpoints, ledger, recipient, label, token and caps, unchanged.
2. **Control: R4a, the agent check.** Control reads, at the evaluated block and on two RPC endpoints:
   - `AgentRegistry.check(agentId, payeeId, token, amount)`,
   - `AgentRegistry.agent(agentId).key`, compared with `LaneRegistry.activeKey(Agent)`.

   A mismatch blocks with `AGENT_BLOCKED` and reason `agent N: AGENT_KEY_MISMATCH`; a registry refusal blocks with the registry's code (for example `agent 1: OVER_HUMAN_QUOTA`); disagreeing endpoints fail closed (`LEDGER_UNVERIFIED`).
3. **R5 and the chain.** Control simulates `GuardedVault.payForAgent`; the signer re-simulates and sends it. On-chain, the vault calls `AgentRegistry.consume`, which re-runs `check` and records the spend, then applies every vault rule. If anything fails, the whole transaction reverts, including the spend counters.

The order of `check` is fixed, so the first failing rule names the code:

```text
UNKNOWN_AGENT → AGENT_REVOKED → AGENT_BANNED → HUMAN_UNBOUND → HUMAN_FROZEN
→ NOT_PERMITTED → PAYEE_NOT_DELEGATED → OVER_AGENT_TX_LIMIT → OVER_AGENT_DAILY_LIMIT → OVER_HUMAN_QUOTA
```

The signer adds one more rule: a registered-agent deployment pays only for its own `agentId`, and only through `payForAgent`. A control-signed request for a different agent is refused.

> [!IMPORTANT]
> The agent id comes from the deployment file, not from the model or the Steward process. A compromised model cannot spend another agent's budget by claiming a different id.

## Freeze and revoke

| Action | Call | Effect |
| --- | --- | --- |
| Freeze all | `freeze(true)` · `tyrell agents freeze` | Every agent of the human returns `HUMAN_FROZEN` until `freeze(false)` |
| Revoke one | `revokeAgent(id, reason)` · `tyrell agents revoke 2 --reason "leaked"` | That agent is `AGENT_REVOKED` for good; its key can never be registered again; other agents keep working |

Revoking an agent in the registry is independent of revoking its lane key in `LaneRegistry` (`tyrell revoke --lane agent`). Do both after a compromise: the registry stops its spending everywhere, the lane revocation stops it anchoring memories.

## Seeing your agents

```sh
tyrell agents list
```

```json
{
  "human": "0xA11CE…",
  "qieId": "alice.qie",
  "bound": true,
  "frozen": false,
  "quotaToday": { "quota": "6000000", "spent": "4000000" },
  "configuredAgentId": "1",
  "agents": [
    { "id": "1", "label": "rent agent", "thisDeployment": true, "status": "active", "permissions": ["pay"],
      "perTxLimit": "4000000", "dailyLimit": "5000000", "spentToday": "3000000", "anyPayee": false,
      "bond": "10000000", "reputation": "520" }
  ]
}
```

## Tested

- The Foundry suite `test/Agents.t.sol` covers every rule above, plus a fuzz test that the shared quota and per-agent limits are never exceeded across days.
- `apps/steward/test/agents.test.ts` runs the full path end to end on anvil: control, policy, signer, vault, a second agent sharing the quota, a QIE ID transfer, a key mismatch and the signer's refusal.
- The same rules run live in the [playground](/playground).
