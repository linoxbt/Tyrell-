---
title: Agents network contracts
description: Reference for AgentRegistry, AgentNetwork, the QIE ID interface, TestQieId and the GuardedVault additions: every function, event, error and code.
---

All contracts: Solidity 0.8.28, EVM `shanghai`, OpenZeppelin 5.4.0, Apache-2.0. Sources in `contracts/src`, tests in `contracts/test/Agents.t.sol`. See the [overview](/docs/agents/overview) for how they fit together.

## IQieId

The read side of a QIE ID record store.

```solidity
function resolveCurrency(string calldata domain, string calldata currency) external view returns (address);
```

| Network | Store |
| --- | --- |
| QIE Mainnet (1990) | `0x8777d01d509D0eA71FB38F88F79867da558d5018`, ERC1967 proxy, implementation `PaymentMetadata` (also exported as `QIE_ID_STORE_MAINNET` from `@tyrell/chain`) |
| QIE Testnet (1983), local, playground | `TestQieId` (QIE ID is not deployed on testnet) |

Tyrell always queries the `"qie"` record. The mainnet store returns the zero address for unknown names and reverts for expired free names; `AgentRegistry` treats both as "resolves to nobody".

## AgentRegistry

`constructor(IQieId qieIdStore_)`. The deployer may link the network once (`setNetwork`).

### Constants and state

| Name | Value / type | Meaning |
| --- | --- | --- |
| `PERM_PAY` | `1` | May pay delegated payees |
| `PERM_MEMORY` | `2` | May write memories for the human (informational) |
| `PERM_MESSAGE` | `4` | May send agent-to-agent messages |
| `PERM_DEAL` | `8` | May be the paying side of a deal |
| `MAX_AGENTS` | `64` | Active agents per human |
| `QIE_RECORD` | `"qie"` | Record queried on the QIE ID store |
| `qieIdStore` | `IQieId` (immutable) | The store bindings are checked against |
| `deployer` | `address` (immutable) | May call `setNetwork` once |
| `network` | `address` | The linked `AgentNetwork` (may `ban`) |
| `humanOfQieId(bytes32)` | `address` | Who holds a binding for `keccak256(qieId)` |
| `quota(human, token)` | `uint256` | Daily quota shared by the human's agents |
| `isSpender(human, spender)` | `bool` | Contracts allowed to charge the human's agents |
| `keyUsed(address)` | `bool` | Keys ever registered (never reusable) |
| `banned(agentId)` | `bool` | Banned by the network |
| `payeeAllowed(agentId, payeeId)` | `bool` | Delegated payees |

### Humans and QIE ID

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `bindQieId(string qieId)` | anyone | Requires `resolveCurrency(qieId, "qie") == msg.sender` else `QieIdNotOwned`. Replaces the caller's previous binding; takes over a name from a previous binder. Emits `HumanBound`. |
| `isBound(address h) view` | | `true` only while the human's QIE ID resolves to them, checked live |
| `freeze(bool frozen)` | the human | Stops or restarts all of the caller's agents. Emits `HumanFrozen`. |
| `setQuota(address token, uint256 daily)` | the human | Emits `QuotaSet` |
| `setSpender(address spender, bool allowed)` | the human | Emits `SpenderSet` |
| `human(address h) view` | | `Human { qieId, boundAt, frozen, agentCount }` |

### Agents

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `registerAgent(key, label, metaHash, permissions, perTxLimit, dailyLimit, anyPayee) returns (agentId)` | bound human | `NotBound`, `BadKey` (zero, self, reused, a human's address), `TooManyAgents`. Emits `AgentRegistered`, `AgentPermissionsSet`, `AgentLimitsSet` (and `AgentAnyPayeeSet` if `anyPayee`). |
| `setPermissions(agentId, permissions)` | the agent's human | Emits `AgentPermissionsSet` |
| `setLimits(agentId, perTx, daily)` | the agent's human | Emits `AgentLimitsSet` |
| `setPayees(agentId, bytes32[] payeeIds, bool allowed)` | the agent's human | Emits `AgentPayeeSet` per payee |
| `setAnyPayee(agentId, bool)` | the agent's human | Emits `AgentAnyPayeeSet` |
| `revokeAgent(agentId, string reason)` | the agent's human | Permanent. Emits `AgentRevoked`. |
| `agent(agentId) view` | | `Agent { key, human, label, metaHash, permissions, perTxLimit, dailyLimit, createdAt, revokedAt, revoked, anyPayee }`; `UnknownAgent` |
| `humanOf(agentId) view` | | `UnknownAgent` |
| `agentIdOf(address key) view` | | Active agent id for a key, 0 if unknown or revoked |
| `agentsOf(address human) view` | | All agent ids ever registered by the human |
| `agentCount() view` | | Total agents |

Management calls revert with `UnknownAgent`, `NotYourAgent` or `AgentIsRevoked` as appropriate.

### Checks and spending

| Function | Access | Returns / effect |
| --- | --- | --- |
| `status(agentId) view` | | `(ok, code)`: `UNKNOWN_AGENT`, `AGENT_REVOKED`, `AGENT_BANNED`, `HUMAN_UNBOUND`, `HUMAN_FROZEN` |
| `hasPermission(agentId, permission) view` | | `bool` |
| `check(agentId, payeeId, token, amount) view` | | `(ok, code)`: `status` codes, then `NOT_PERMITTED`, `PAYEE_NOT_DELEGATED`, `OVER_AGENT_TX_LIMIT`, `OVER_AGENT_DAILY_LIMIT`, `OVER_HUMAN_QUOTA` |
| `consume(agentId, payeeId, token, amount)` | spenders of the agent's human | `NotSpender`; `AgentBlocked(code)` if `check` fails; records the spend for the agent and the human. Emits `AgentSpent`. |
| `spentToday(agentId, token) view` | | Agent spend this UTC day |
| `humanSpentToday(human, token) view` | | Human spend this UTC day (all agents) |

### Network link

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `setNetwork(address)` | deployer, once | `OnlyNetwork` (not the deployer), `NetworkAlreadySet`. Emits `NetworkSet`. |
| `ban(agentId)` | the network | `OnlyNetwork`, `UnknownAgent`. Emits `AgentBanned`. |

### Events

`HumanBound(human, qieId, qieIdHash)` · `HumanFrozen(human, frozen)` · `QuotaSet(human, token, dailyQuota)` · `SpenderSet(human, spender, allowed)` · `AgentRegistered(agentId, human, key, label, metaHash)` · `AgentPermissionsSet(agentId, permissions)` · `AgentLimitsSet(agentId, perTxLimit, dailyLimit)` · `AgentPayeeSet(agentId, payeeId, allowed)` · `AgentAnyPayeeSet(agentId, anyPayee)` · `AgentRevoked(agentId, key, reason)` · `AgentBanned(agentId)` · `AgentSpent(agentId, human, payeeId, token, amount, spender)` · `NetworkSet(network)`

### Errors

`QieIdNotOwned(string)` · `NotBound(address)` · `NotYourAgent(uint256)` · `UnknownAgent(uint256)` · `AgentIsRevoked(uint256)` · `BadKey(address)` · `TooManyAgents()` · `NotSpender(address)` · `AgentBlocked(bytes32 code)` · `OnlyNetwork()` · `NetworkAlreadySet()`

### Registry codes

| Code | Meaning |
| --- | --- |
| `UNKNOWN_AGENT` | No such agent |
| `AGENT_REVOKED` | Revoked by its human |
| `AGENT_BANNED` | Banned by the network after upheld reports |
| `HUMAN_UNBOUND` | The human's QIE ID no longer resolves to them (moved, expired, deleted) |
| `HUMAN_FROZEN` | The human froze all of their agents |
| `NOT_PERMITTED` | Missing the `PAY` permission |
| `PAYEE_NOT_DELEGATED` | That payee was not delegated to the agent |
| `OVER_AGENT_TX_LIMIT` | Over the agent's per-payment limit, or zero |
| `OVER_AGENT_DAILY_LIMIT` | Over the agent's daily limit |
| `OVER_HUMAN_QUOTA` | Over the human's daily quota shared by all agents (also when no quota is set) |

Control adds two codes in the `AGENT_BLOCKED` reason when it cannot trust the registry read: `AGENT_KEY_MISMATCH` (the registered key is not this deployment's agent-lane key) and `REGISTRY_UNAVAILABLE`. See [Policy rules](/docs/reference/policy-rules#r4a-agent-registry).

## AgentNetwork

`constructor(registry, bondToken, arbiter, minBond, reportBond, contestWindow, slashBps, banAfter)`. Reverts `BadParams` for zero addresses, zero amounts or windows, `slashBps` of 0 or above 10,000, or `banAfter` of 0. All parameters are immutable. EIP-712 domain: `TyrellAgentNetwork`, version `1`.

### Bonds

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `bond(agentId, amount)` | anyone | `BadAmount`, `UnknownAgent`. Emits `Bonded`. |
| `withdrawBond(agentId, amount)` | the agent's human | `NotHumanOf`, `OpenReports`, `BadAmount`, `BelowMinBond`. Emits `BondWithdrawn`. |
| `isBonded(agentId) view` | | `bondOf >= minBond` |
| `bondOf(agentId)`, `openReports(agentId)` | | state |

### Reports

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `fileReport(agentId, category, evidenceHash, evidenceCid) returns (reportId)` | bound humans | `NotBound`, `SelfReport`, `BadParams` (zero hash), `UnknownAgent`. Takes `reportBond`. Emits `ReportFiled`. |
| `contest(reportId)` | the accused human | `NotHumanOf`, `WindowClosed`, `WrongStatus`. Takes `reportBond`. Emits `ReportContested`. |
| `finalize(reportId)` | anyone | `WindowOpen`, `WrongStatus`. Upholds. |
| `resolve(reportId, upheld)` | `arbiter` | `OnlyArbiter`, `WrongStatus`. Emits `ReportUpheld` or `ReportDismissed`. |
| `report(reportId) view` | | `Report { agentId, reporter, accused, category, evidenceHash, evidenceCid, filedAt, status, slashed }`; `UnknownReport` |
| `reportCount() view`, `falseReports(human)` | | state |

Status: `None`, `Open`, `Contested`, `Upheld`, `Dismissed`. Payouts are described in [Bonds, reports and penalties](/docs/agents/bonds-and-reports#penalties-and-payouts).

### Messages

| Function | Returns |
| --- | --- |
| `AGENT_MESSAGE_TYPEHASH` | `keccak256("AgentMessage(uint256 fromAgent,uint256 toAgent,bytes32 bodyHash,uint256 nonce,uint64 deadline)")` |
| `messageDigest(fromAgent, toAgent, bodyHash, nonce, deadline) view` | The EIP-712 digest the sender's key signs |
| `verifyMessage(fromAgent, toAgent, bodyHash, nonce, deadline, signature) view` | `(ok, code)`: `EXPIRED`, sender status codes, `RECIPIENT_INACTIVE`, `NOT_PERMITTED`, `NOT_BONDED`, `BAD_SIGNATURE` |
| `domainSeparator() view` | The EIP-712 domain separator |

### Deals

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `openDeal(fromAgent, toAgent, token, amount, termsHash, deadline) returns (dealId)` | the paying agent's human | `NotHumanOf`, `SameHuman`, `DeadlinePassed`, `AgentNotActive(id, code)`, `NotPermitted`, `NotBonded`, registry `NotSpender` / `AgentBlocked`. Escrows `amount`. Emits `DealOpened`. |
| `confirmDeal(dealId)` | payer | `NotHumanOf`, `WrongStatus`. Pays the payee's human; credits both agents. Emits `DealCompleted`. |
| `cancelDeal(dealId)` | payee | `NotHumanOf`, `WrongStatus`. Refunds. Emits `DealCancelled`. |
| `reclaim(dealId)` | payer | `DeadlineNotPassed`, `NotHumanOf`, `WrongStatus`. Refunds. Emits `DealReclaimed`. |
| `deal(dealId) view` | | `Deal { fromAgent, toAgent, payer, payee, token, amount, termsHash, deadline, status }`; `UnknownDeal` |
| `dealCount() view` | | |

Deal status: `None`, `Open`, `Completed`, `Cancelled`, `Reclaimed`.

### Reputation

| Function | Returns |
| --- | --- |
| `reputation(agentId) view` | 0..1000, see [Reputation](/docs/agents/reputation) |
| `record(agentId) view` | `Record { dealsCompleted, reportsUpheld, reportsDismissed, volume }` |

### Events

`Bonded(agentId, from, amount, total)` · `BondWithdrawn(agentId, to, amount, total)` · `ReportFiled(reportId, agentId, reporter, category, evidenceHash, evidenceCid)` · `ReportContested(reportId, accused)` · `ReportUpheld(reportId, agentId, slashed, banned)` · `ReportDismissed(reportId, agentId)` · `DealOpened(dealId, fromAgent, toAgent, token, amount, termsHash, deadline)` · `DealCompleted(dealId)` · `DealCancelled(dealId)` · `DealReclaimed(dealId)`

### Errors

`NotBound` · `NotHumanOf` · `AgentNotActive` · `SelfReport` · `OpenReports` · `BelowMinBond` · `BadAmount` · `UnknownReport` · `UnknownDeal` · `WrongStatus` · `WindowClosed` · `WindowOpen` · `OnlyArbiter` · `SameHuman` · `NotPermitted` · `NotBonded` · `DeadlinePassed` · `DeadlineNotPassed` · `BadParams`

## GuardedVault additions

| Member | Access | Meaning |
| --- | --- | --- |
| `agentRegistry() view` | | The registry this vault charges (zero for single-agent use) |
| `setAgentRegistry(IAgentRegistry)` | admin (the owner) | Emits `AgentRegistrySet` |
| `payForAgent(agentId, payeeId, token, amount, decisionId)` | `SIGNER_ROLE` | `NoAgentRegistry`; then `AgentRegistry.consume(...)` (`NotSpender`, `AgentBlocked(code)`); then every `pay` rule. Emits `Paid` and `PaidForAgent`. |
| `PaidForAgent(agentId, payeeId, token, amount, decisionId)` | event | |
| `NoAgentRegistry()` | error | |

`pay` is unchanged. A registered-agent deployment uses `payForAgent` exclusively: the signer refuses agent requests for other agent ids.

## TestQieId

For local chains, QIE Testnet and the playground. Not for mainnet.

| Function | Effect / reverts |
| --- | --- |
| `claim(name)` | Takes a free (or lapsed) name for the caller; `NameTaken` |
| `transferName(name, to)` | `NotHolder` |
| `lapse(name)` | Simulates an expired free name (resolution reverts); `NotHolder` |
| `resolveCurrency(domain, currency) view` | The holder for currency `"qie"`, zero otherwise; reverts `Metadata:domain expired` if lapsed |

Events: `Claimed(name, holder)`, `Transferred(name, from, to)`, `Lapsed(name)`.
