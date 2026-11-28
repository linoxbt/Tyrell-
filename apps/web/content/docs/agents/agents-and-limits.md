---
title: Agents, permissions and quota
description: Phase A. Register agents under a QIE-ID-bound human, set permissions and limits, delegate payees, share one daily quota, freeze and revoke.
---

Phase A gives one human many agents, each with its own key, permissions and limits, all drawing on one daily quota. `AgentRegistry` holds the rules; `GuardedVault.payForAgent` and `AgentNetwork.openDeal` enforce them on-chain, and control's policy engine checks them first.

## Registering an agent

The human, bound to a QIE ID, calls:

```solidity
struct NewAgent {
    address key;          // the agent's key: a Tyrell deployment's agent-lane key
    address token;        // the one token this agent spends (its limits are in this token)
    string label;         // a name for people, e.g. "rent agent"
    bytes32 metaHash;     // hash of a model/operator description (optional)
    uint32 permissions;   // bit flags, see below
    uint128 perTxLimit;   // most the agent may spend at once (token base units)
    uint128 dailyLimit;   // most the agent may spend per UTC day
    bool anyPayee;        // false: only delegated payees
}

function registerAgent(NewAgent calldata n, uint64 deadline, bytes calldata keySig)
    external returns (uint256 agentId);
```

`keySig` is the **agent key's own consent**: an EIP-712 signature, by `n.key`, of

```text
domain  TyrellAgentRegistry, version 1, this chain, the AgentRegistry address
type    RegisterAgent(address human, address key, uint64 deadline)
```

with `human` = the caller. Agent keys are public (every anchored memory shows its signer), so without this anyone could register your deployment's agent key under themselves first and you could never register it. With it, only someone holding the key can say whose agent it is. A key registers once ever, so the signature can't be replayed; the deadline limits how long a consent you handed out stays usable.

Rules:

- The caller must be bound (`NotBound` otherwise).
- The key must be new: not zero, not the caller, never used before, not a human's address (`BadKey`). Keys are never reused, even after revocation.
- The token can't be zero (`BadToken`).
- The consent must be signed by the key for this caller (`BadKeySignature`) and not past its deadline (`SignatureExpired`).
- At most `MAX_AGENTS` (64) active agents per human (`TooManyAgents`).
- Agent ids start at 1 and never change.

From the CLI, in the deployment whose agent-lane key you are registering, the CLI signs the consent with that key for you:

```sh
tyrell agents register --label "rent agent" --per-tx 4 --daily 5 --perms pay,memory
```

Amounts are in token units (the CLI reads the token's decimals), and the agent's token is the deployment's token. Without `--key`, the deployment's own agent-lane key is registered, and after the transaction is mined the CLI checks that the new agent id really is yours with that key, then writes `agentId` into the deployment file. Next run `tyrell agents link-vault` (see [Spenders](#spenders)).

To register **another deployment's** key under you, get its consent first. On that deployment:

```sh
tyrell agents consent 0xYourOwnerAddress --ttl 86400
# {"human":"0xYourOwnerAddress","key":"0xAgentKey…","deadline":"1767312000","signature":"0x…"}
```

then on yours:

```sh
tyrell agents register --label "research agent" --per-tx 1 --daily 2 \
  --key 0xAgentKey… --key-sig 0x… --sig-deadline 1767312000
```

The CLI checks the signature locally before asking your wallet to send anything.

## Permissions

| Bit | Name | Lets the agent… |
| --- | --- | --- |
| `1` | `PAY` | propose payments to the human's payees (`payForAgent`) |
| `2` | `MEMORY` | write memories on the human's behalf: once the deployment is linked (`MemoryAnchor.linkAgent`), an agent-lane memory is refused without it (`NoMemoryPermission`) |
| `4` | `MESSAGE` | send agent-to-agent messages that `verifyMessage` will accept |
| `8` | `DEAL` | be the paying side of an agent-to-agent deal (deals check `DEAL`, not `PAY`) |

`tyrell agents register` grants `pay,memory` unless you pass `--perms`. Change them with `setPermissions(agentId, mask)` or `tyrell agents perms <id> pay,memory,deal`. In TypeScript, `@tyrell/core` exports `PERM`, `permMask` and `permNames`.

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

Each agent spends **one token**, chosen at registration, so its per-payment and daily limits are single figures in that token, not one allowance per token. A payment or deal in any other token is refused with `WRONG_TOKEN`.

The human's quota is per token and **fails closed**: a token with no quota cannot be spent by any agent. For example, with a quota of 6 QUSDC, if agent #1 spends 3, agent #2 can spend at most 3 more today, even if its own daily limit is 4.

```sh
tyrell agents quota 6
tyrell agents limits 1 4 5
```

These limits stack with the vault's own rules (payee caps, the vault-wide daily cap), never replace them.

## Spenders

Only contracts the human authorised can charge their agents:

```solidity
function setSpender(address spender, bool allowed) external;
function consume(uint256 agentId, bytes32 payeeId, address token, uint256 amount) external;     // PAY, spenders only
function consumeDeal(uint256 agentId, bytes32 payeeId, address token, uint256 amount) external; // DEAL, spenders only
function refund(uint256 agentId, address token, uint256 amount, uint256 day) external;          // spenders only
```

`refund` gives a charge back for the UTC day it was made: the network calls it when a deal is cancelled, reclaimed or refunded, so money that never left doesn't use up the agent's limit or the human's quota.

Link the deployment to its agent with:

```sh
tyrell agents link-vault
```

It asks QIE Wallet for these owner transactions, then waits for each receipt:

1. `AgentRegistry.setSpender(vault, true)`: the vault may charge your agents.
2. `GuardedVault.setAgentRegistry(registry)`: from now on the vault pays only through `payForAgent`; plain `pay` reverts with `UseAgentPath`, so freezes, bans, an expired QIE ID, agent limits and the quota can't be skipped.
3. `MemoryAnchor.linkAgent(registry, agentId)`: agent-lane memories need this agent to be active, to hold `MEMORY`, and to be signed by its registered key.
4. If the deployment is linked to an agents network: `AgentRegistry.setSpender(network, true)`, so deals can charge your agents.

A spender the human did not authorise gets `NotSpender`. So one human's vault cannot charge another human's agents, and a stranger cannot burn your quota. And `payForAgent` itself only pays for agents whose human administers that vault (`NotOurAgent` otherwise), so a vault can't be used to spend someone else's agent either.

## How a payment is checked

When the Steward agent of a registered deployment proposes a payment, three layers check it.

1. **Control: policy engine R0 to R4.** Endpoints, ledger, recipient, label, token and caps, unchanged.
2. **Control: R4a, the agent check.** Control reads, at the evaluated block and on two RPC endpoints:
   - `AgentRegistry.check(agentId, payeeId, token, amount)`,
   - `AgentRegistry.agent(agentId).key`, compared with `LaneRegistry.activeKey(Agent)`.

   A mismatch blocks with `AGENT_BLOCKED` and reason `agent N: AGENT_KEY_MISMATCH`; a registry refusal blocks with the registry's code (for example `agent 1: OVER_HUMAN_QUOTA`); disagreeing endpoints fail closed (`LEDGER_UNVERIFIED`).
3. **R5 and the chain.** Control simulates `GuardedVault.payForAgent`; the signer re-simulates and sends it. On-chain, the vault checks the agent's human is one of its admins (`NotOurAgent`), calls `AgentRegistry.consume`, which re-runs `check` and records the spend, then applies every vault rule. If anything fails, the whole transaction reverts, including the spend counters.

The order of `check` is fixed, so the first failing rule names the code:

```text
UNKNOWN_AGENT → AGENT_REVOKED → AGENT_BANNED → HUMAN_UNBOUND → HUMAN_FROZEN
→ NOT_PERMITTED → WRONG_TOKEN → PAYEE_NOT_DELEGATED → OVER_AGENT_TX_LIMIT → OVER_AGENT_DAILY_LIMIT → OVER_HUMAN_QUOTA
```

The signer adds one more rule: a registered-agent deployment pays only for its own `agentId`, and only through `payForAgent`. A control-signed request for a different agent is refused.

> [!IMPORTANT]
> The agent id comes from the deployment file, not from the model or the Steward process. A compromised model cannot spend another agent's budget by claiming a different id.

## Freeze and revoke

| Action | Call | Effect |
| --- | --- | --- |
| Freeze all | `freeze(true)` · `tyrell agents freeze` | Every agent of the human returns `HUMAN_FROZEN` until `freeze(false)` |
| Revoke one | `revokeAgent(id, reason)` · `tyrell agents revoke 2 --reason "leaked"` | That agent is `AGENT_REVOKED` for good; its key can never be registered again; other agents keep working |

Revoking an agent in the registry is independent of revoking its lane key in `LaneRegistry` (`tyrell revoke --lane agent`). Do both after a compromise: the registry stops its spending everywhere (and, on a linked deployment, its memories), the lane revocation stops it anchoring memories anywhere.

> [!NOTE]
> A registered agent's key can't be changed. If you rotate a linked deployment's agent-lane key, register the new key as a new agent, run `tyrell agents link-vault` again, and revoke the old agent: until then control blocks payments with `AGENT_KEY_MISMATCH` and `MemoryAnchor` refuses agent memories with `AgentKeyMismatch`.

## Seeing your agents

```sh
tyrell agents list
```

It costs a fixed handful of reads however many agents you ever registered (`AgentRegistry.agentsView` and `AgentNetwork.stats`).

```json
{
  "human": "0xA11CE…",
  "qieId": "alice.qie",
  "bound": true,
  "frozen": false,
  "quotaToday": { "quota": "6000000", "spent": "4000000" },
  "configuredAgentId": "1",
  "agents": [
    { "id": "1", "label": "rent agent", "key": "0xA6E7…", "token": "0x3F43…", "thisDeployment": true,
      "status": "active", "permissions": ["pay", "memory"],
      "perTxLimit": "4000000", "dailyLimit": "5000000", "spentToday": "3000000", "anyPayee": false,
      "bond": "10000000", "reputation": "520" }
  ]
}
```

## Tested

- The Foundry suite `test/Agents.t.sol` covers every rule above, plus a fuzz test that the shared quota and per-agent limits are never exceeded across days.
- `apps/steward/test/agents.test.ts` runs the full path end to end on anvil: control, policy, signer, vault, a second agent sharing the quota, a QIE ID transfer, a key mismatch and the signer's refusal.
- The same rules run live in the [playground](/playground).
