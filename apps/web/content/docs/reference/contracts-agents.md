---
title: Agents network contracts
description: Reference for AgentRegistry, AgentNetwork, the QIE ID interface, TestQieId and the GuardedVault and MemoryAnchor additions: every function, event, error and code.
---

All contracts: Solidity 0.8.28, EVM `shanghai`, OpenZeppelin 5.4.0, MIT. Sources in `contracts/src`, tests in `contracts/test/Agents.t.sol`. See the [overview](/docs/agents/overview) for how they fit together.

## IQieId

The read side of a QIE ID record store.

```solidity
function resolveCurrency(string calldata domain, string calldata currency) external view returns (address);
```

| Network | Store |
| --- | --- |
| QIE Mainnet (1990) | `0x8777d01d509D0eA71FB38F88F79867da558d5018`, ERC1967 proxy, implementation `PaymentMetadata` (also exported as `QIE_ID_STORE_MAINNET` from `@tyrell/chain`). `DeployNetwork.s.sol` refuses any other store on mainnet. |
| QIE Testnet (1983), local, playground | `TestQieId` (QIE ID is not deployed on testnet) |

Tyrell always queries the `"qie"` record. The mainnet store returns the zero address for unknown names and reverts for expired free names; `AgentRegistry` treats both as "resolves to nobody".

## AgentRegistry

`constructor(IQieId qieIdStore_)`. EIP-712 domain: `TyrellAgentRegistry`, version `1`. The deployer may link the network once (`setNetwork`).

### Constants and state

| Name | Value / type | Meaning |
| --- | --- | --- |
| `PERM_PAY` | `1` | May pay delegated payees (`consume`) |
| `PERM_MEMORY` | `2` | May write memories for the human; enforced by `MemoryAnchor` once linked |
| `PERM_MESSAGE` | `4` | May send agent-to-agent messages |
| `PERM_DEAL` | `8` | May be the paying side of a deal (`consumeDeal`) |
| `MAX_AGENTS` | `64` | Active agents per human |
| `QIE_RECORD` | `"qie"` | Record queried on the QIE ID store |
| `REGISTER_AGENT_TYPEHASH` | `keccak256("RegisterAgent(address human,address key,uint64 deadline)")` | The agent key's registration consent |
| `qieIdStore` | `IQieId` (immutable) | The store bindings are checked against |
| `deployer` | `address` (immutable) | May call `setNetwork` once |
| `network` | `address` | The linked `AgentNetwork` (may `ban` and `unban`) |
| `humanOfQieId(bytes32)` | `address` | Who holds a binding for `keccak256(qieId)` |
| `quota(human, token)` | `uint256` | Daily quota shared by the human's agents |
| `isSpender(human, spender)` | `bool` | Contracts allowed to charge the human's agents |
| `chargedBy(agentId, day, spender)` | `uint256` | What `spender` charged the agent on UTC `day`, less what it refunded: the most it can still refund |
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

```solidity
struct NewAgent { address key; address token; string label; bytes32 metaHash; uint32 permissions;
                  uint128 perTxLimit; uint128 dailyLimit; bool anyPayee; }
```

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `registerAgent(NewAgent n, uint64 deadline, bytes keySig) returns (agentId)` | bound human | `keySig` is `n.key`'s EIP-712 signature of `RegisterAgent(human = caller, key, deadline)`. `NotBound`, `BadKey` (zero, self, reused, a human's address), `BadToken` (zero token), `SignatureExpired`, `BadKeySignature`, `TooManyAgents`. Emits `AgentRegistered`, `AgentTokenSet`, `AgentPermissionsSet`, `AgentLimitsSet` (and `AgentAnyPayeeSet` if `anyPayee`). |
| `registrationDigest(human, key, deadline) view` | | The digest the agent key signs |
| `rotateAgentKey(agentId, newKey, uint64 deadline, bytes keySig)` | the agent's human | `keySig` is `newKey`'s EIP-712 signature of `RotateAgentKey(uint256 agentId, address human, address key, uint64 deadline)`. `BadKey` (zero, self, ever used, a human's address), `SignatureExpired`, `BadKeySignature`, plus the management reverts. The agent keeps its id and everything else; the old key is retired for good. Emits `AgentKeyRotated`. |
| `rotationDigest(agentId, human, key, deadline) view` | | The digest the new key signs |
| `domainSeparator() view` | | The EIP-712 domain separator |
| `setPermissions(agentId, permissions)` | the agent's human | Emits `AgentPermissionsSet` |
| `setLimits(agentId, perTx, daily)` | the agent's human | In the agent's token. Emits `AgentLimitsSet` |
| `setPayees(agentId, bytes32[] payeeIds, bool allowed)` | the agent's human | Emits `AgentPayeeSet` per payee |
| `setAnyPayee(agentId, bool)` | the agent's human | Emits `AgentAnyPayeeSet` |
| `revokeAgent(agentId, string reason)` | the agent's human | Permanent. Emits `AgentRevoked`. |
| `agent(agentId) view` | | `Agent { key, human, token, label, metaHash, permissions, perTxLimit, dailyLimit, createdAt, revokedAt, revoked, anyPayee }`; `UnknownAgent` |
| `agentsView(address human) view` | | `AgentView[] { id, agent, ok, code, spentToday }` for every agent the human ever registered, in one call |
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
| `check(agentId, payeeId, token, amount) view` | | `(ok, code)` for a payment (`PAY`): `status` codes, then `NOT_PERMITTED`, `WRONG_TOKEN`, `PAYEE_NOT_DELEGATED`, `OVER_AGENT_TX_LIMIT`, `OVER_AGENT_DAILY_LIMIT`, `OVER_HUMAN_QUOTA` |
| `checkDeal(agentId, payeeId, token, amount) view` | | The same for the paying side of a deal (`DEAL`) |
| `consume(agentId, payeeId, token, amount)` | spenders of the agent's human | `NotSpender`; `AgentBlocked(code)` if `check` fails; records the spend for the agent, the human and the spender (`chargedBy`). Emits `AgentSpent`. |
| `consumeDeal(agentId, payeeId, token, amount)` | spenders of the agent's human | The same with `checkDeal` |
| `refund(agentId, token, amount, day)` | whoever charged it | Takes `amount` off the agent's and the human's spend for UTC `day`. At most what the caller charged that agent that day (`OverRefund(charged, amount)`); `BadToken` unless `token` is the agent's own. Needs no current spender status, so a deal opened before the human removed the network can still be refunded. Emits `AgentRefunded`. |
| `spentToday(agentId, token) view` | | Agent spend this UTC day (0 for any token but the agent's own) |
| `humanSpentToday(human, token) view` | | Human spend this UTC day (all agents) |

### Network link

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `setNetwork(address)` | deployer, once | `OnlyNetwork` (not the deployer), `NetworkAlreadySet`. Emits `NetworkSet`. |
| `ban(agentId)` | the network | `OnlyNetwork`, `UnknownAgent`. Emits `AgentBanned`. |
| `unban(agentId)` | the network | `OnlyNetwork`, `UnknownAgent`. Emits `AgentUnbanned`. |

### Events

`HumanBound(human, qieId, qieIdHash)` · `HumanFrozen(human, frozen)` · `QuotaSet(human, token, dailyQuota)` · `SpenderSet(human, spender, allowed)` · `AgentRegistered(agentId, human, key, label, metaHash)` · `AgentTokenSet(agentId, token)` · `AgentPermissionsSet(agentId, permissions)` · `AgentLimitsSet(agentId, perTxLimit, dailyLimit)` · `AgentPayeeSet(agentId, payeeId, allowed)` · `AgentAnyPayeeSet(agentId, anyPayee)` · `AgentRevoked(agentId, key, reason)` · `AgentKeyRotated(agentId, oldKey, newKey)` · `AgentBanned(agentId)` · `AgentUnbanned(agentId)` · `AgentSpent(agentId, human, payeeId, token, amount, spender)` · `AgentRefunded(agentId, human, token, amount, day, spender)` · `NetworkSet(network)`

### Errors

`QieIdNotOwned(string)` · `NotBound(address)` · `NotYourAgent(uint256)` · `UnknownAgent(uint256)` · `AgentIsRevoked(uint256)` · `BadKey(address)` · `BadKeySignature()` · `SignatureExpired()` · `BadToken()` · `TooManyAgents()` · `NotSpender(address)` · `OverRefund(uint256 charged, uint256 amount)` · `AgentBlocked(bytes32 code)` · `OnlyNetwork()` · `NetworkAlreadySet()`

### Registry codes

| Code | Meaning |
| --- | --- |
| `UNKNOWN_AGENT` | No such agent |
| `AGENT_REVOKED` | Revoked by its human |
| `AGENT_BANNED` | Banned by the network after upheld rulings |
| `HUMAN_UNBOUND` | The human's QIE ID no longer resolves to them (moved, expired, deleted) |
| `HUMAN_FROZEN` | The human froze all of their agents |
| `NOT_PERMITTED` | Missing the `PAY` permission (payments) or `DEAL` (deals) |
| `WRONG_TOKEN` | Not the token the agent was registered to spend |
| `PAYEE_NOT_DELEGATED` | That payee was not delegated to the agent |
| `OVER_AGENT_TX_LIMIT` | Over the agent's per-payment limit, or zero |
| `OVER_AGENT_DAILY_LIMIT` | Over the agent's daily limit |
| `OVER_HUMAN_QUOTA` | Over the human's daily quota shared by all agents (also when no quota is set) |

Control adds two codes in the `AGENT_BLOCKED` reason when it cannot trust the registry read: `AGENT_KEY_MISMATCH` (the registered key is not this deployment's agent-lane key) and `REGISTRY_UNAVAILABLE`. See [Policy rules](/docs/reference/policy-rules#r4a-agent-registry). `AgentNetwork.verifyMessage` adds `EXPIRED`, `NONCE_USED`, `RECIPIENT_INACTIVE`, `NOT_BONDED` and `BAD_SIGNATURE`.

## AgentNetwork

```solidity
struct Params { address arbiter; uint256 minBond; uint256 reportBond; uint64 contestWindow;
                uint64 ruleWindow; uint16 slashBps; uint8 banAfter; }
constructor(IAgentRegistry registry, IERC20 bondToken, address owner, Params p)
```

Reverts `BadParams` for zero addresses, zero amounts or windows, `slashBps` of 0 or above 10,000, or `banAfter` of 0. All parameters except the arbiter are immutable. `owner` (a council) is an `Ownable2Step` owner that can replace the arbiter; `renounceOwnership` reverts with `NoRenounce`. EIP-712 domain: `TyrellAgentNetwork`, version `1`. `MAX_OPEN_PER_REPORTER` is `5`.

### Owner

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `setArbiter(address)` | owner | `BadParams` (zero). Emits `ArbiterChanged`. |
| `transferOwnership(address)`, `acceptOwnership()` | owner, then the new owner | Two-step hand-over |
| `renounceOwnership()` | | Always reverts `NoRenounce` |

### Bonds

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `bond(agentId, amount)` | anyone | `BadAmount`, `UnknownAgent`. Emits `Bonded`. |
| `requestWithdrawal(agentId, amount)` | the agent's human | `NotHumanOf`, `BadAmount`, `BelowMinBond` (what is left must be 0 or at least `minBond`). Ready one `contestWindow` later. Emits `WithdrawalRequested`. |
| `cancelWithdrawal(agentId)` | the agent's human | `NotHumanOf`, `NoWithdrawal`. Emits `WithdrawalCancelled`. |
| `withdrawBond(agentId)` | the agent's human | `NotHumanOf`, `NoWithdrawal`, `WithdrawalNotReady`, `OpenReports`. Pays the requested amount, less anything slashed meanwhile. Emits `BondWithdrawn`. |
| `effectiveBond(agentId) view` | | `bondOf` minus any pending withdrawal |
| `isBonded(agentId) view` | | `effectiveBond >= minBond` |
| `bondOf(agentId)`, `pendingWithdrawal(agentId)`, `openReports(agentId)` | | state |

### Reports

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `fileReport(agentId, category, evidenceHash, evidenceCid) returns (reportId)` | bound humans | `NotBound`, `SelfReport`, `BadParams` (zero hash), `UnknownAgent`, `AlreadyReported` (one open report per agent), `TooManyOpenReports`, `ReportCooldown` (one `contestWindow` after the last report on that agent closed). Takes `reportBond`. Emits `ReportFiled`. |
| `contest(reportId)` | the accused human | `NotHumanOf`, `WindowClosed`, `WrongStatus`. Takes `reportBond`. Emits `ReportContested`. |
| `finalize(reportId)` | anyone | After the contest window: `WindowOpen`, `WrongStatus`. Refunds the reporter's bond only; nothing slashed. Emits `ReportUncontested`. |
| `resolve(reportId, upheld)` | `arbiter` | Within `ruleWindow` of the contest: `OnlyArbiter`, `WrongStatus`, `WindowClosed`, `ArbiterConflict` (the arbiter filed it, is the accused, or holds the agent). Emits `ReportUpheld` (may ban) or `ReportDismissed`. |
| `lapse(reportId)` | anyone | A contested report past `ruleWindow`: `WindowOpen`, `WrongStatus`. Refunds both bonds. Emits `ReportLapsed`. |
| `appeal(agentId, evidenceCid)` | the agent's human | `NotHumanOf`, `NotBanned`. Emits `BanAppealed`. |
| `unban(agentId, reason)` | `arbiter` | `OnlyArbiter`, `NotBanned`, `ArbiterConflict`. Resets `reportsUpheld`. Emits `BanLifted`. |
| `report(reportId) view` | | `Report { agentId, reporter, accused, category, evidenceHash, evidenceCid, filedAt, contestedAt, status, slashed }`; `UnknownReport` |
| `reportCount() view`, `falseReports(human)`, `openReportsBy(reporter)`, `hasOpenReport(reporter, agentId)`, `lastReportClosed(reporter, agentId)` | | state |

Status: `None`, `Open`, `Contested`, `Upheld`, `Dismissed`, `Uncontested`, `Lapsed`. Payouts are described in [Bonds, reports and penalties](/docs/agents/bonds-and-reports#penalties-and-payouts).

### Messages

| Function | Returns / effect |
| --- | --- |
| `AGENT_MESSAGE_TYPEHASH` | `keccak256("AgentMessage(uint256 fromAgent,uint256 toAgent,bytes32 bodyHash,uint256 nonce,uint64 deadline)")` |
| `messageDigest(fromAgent, toAgent, bodyHash, nonce, deadline) view` | The EIP-712 digest the sender's key signs |
| `verifyMessage(fromAgent, toAgent, bodyHash, nonce, deadline, signature) view` | `(ok, code)`: `EXPIRED`, `NONCE_USED`, sender status codes, `RECIPIENT_INACTIVE`, `NOT_PERMITTED`, `NOT_BONDED`, `BAD_SIGNATURE` |
| `acceptMessage(fromAgent, toAgent, bodyHash, nonce, deadline, signature)` | The receiving agent's human or key: `NotHumanOf`, `MessageRejected(code)`. Marks `(fromAgent, nonce)` used. Emits `MessageAccepted`. |
| `messageUsed(fromAgent, nonce)` | state |
| `domainSeparator() view` | The EIP-712 domain separator |

### Deals

| Function | Access | Effect / reverts |
| --- | --- | --- |
| `openDeal(fromAgent, toAgent, token, amount, termsHash, deadline) returns (dealId)` | the paying agent's human | `NotHumanOf`, `SameHuman`, `DeadlinePassed`, `AgentNotActive(id, code)`, `NotBonded`, registry `NotSpender` / `AgentBlocked(code)` (via `consumeDeal`: `DEAL` permission, token, payee, limits, quota). Escrows `amount`. Emits `DealOpened`. |
| `deliver(dealId)` | payee | Before the deadline: `NotHumanOf`, `WrongStatus`, `DeadlinePassed`. Emits `DealDelivered`. |
| `confirmDeal(dealId)` | payer | Open or Delivered: `NotHumanOf`, `WrongStatus`. Pays the payee's human; credits both agents. Emits `DealCompleted`. |
| `disputeDeal(dealId)` | payer | Delivered, within `contestWindow`: `NotHumanOf`, `WrongStatus`, `WindowClosed`. Emits `DealDisputed`. |
| `claim(dealId)` | payee | Delivered, after `contestWindow` with no dispute: `NotHumanOf`, `WrongStatus`, `WindowOpen`. Emits `DealCompleted`. |
| `resolveDeal(dealId, payPayee)` | `arbiter` | Disputed, within `ruleWindow`: `OnlyArbiter`, `WrongStatus`, `WindowClosed`, `ArbiterConflict`. Pays the payee (`DealCompleted`) or refunds the payer (`DealRefunded`). |
| `lapseDeal(dealId)` | anyone | Disputed, past `ruleWindow`: `WrongStatus`, `WindowOpen`. Refunds the payer. Emits `DealRefunded`. |
| `cancelDeal(dealId)` | payee | Open, Delivered or Disputed: `NotHumanOf`, `WrongStatus`. Refunds. Emits `DealCancelled`. |
| `reclaim(dealId)` | payer | Open (never delivered), after the deadline: `DeadlineNotPassed`, `NotHumanOf`, `WrongStatus`. Refunds. Emits `DealReclaimed`. |
| `deal(dealId) view` | | `Deal { fromAgent, toAgent, payer, payee, token, amount, termsHash, deadline, openedDay, deliveredAt, disputedAt, status }`; `UnknownDeal` |
| `dealCount() view` | | |

Every refund also gives the charge back to the paying agent and its human through `AgentRegistry.refund` for the day it was made. Deal status: `None`, `Open`, `Completed`, `Cancelled`, `Reclaimed`, `Delivered`, `Disputed`, `Refunded`.

### Reputation

| Function | Returns |
| --- | --- |
| `reputation(agentId) view` | 0..1000, see [Reputation](/docs/agents/reputation) |
| `record(agentId) view` | `Record { dealsCompleted, reportsUpheld, reportsDismissed, reportsUncontested, volume }` |
| `stats(uint256[] agentIds) view` | `(bonds, pending, reputations)` for many agents in one call. `bonds` is `effectiveBond` (what `isBonded` and `reputation` use); `pending` is the withdrawal waiting to leave (still slashable); `bondOf = bonds + pending` |

### Events

`Bonded(agentId, from, amount, total)` · `WithdrawalRequested(agentId, amount, readyAt)` · `WithdrawalCancelled(agentId)` · `BondWithdrawn(agentId, to, amount, total)` · `ReportFiled(reportId, agentId, reporter, category, evidenceHash, evidenceCid)` · `ReportContested(reportId, accused)` · `ReportUpheld(reportId, agentId, slashed, banned)` · `ReportDismissed(reportId, agentId)` · `ReportUncontested(reportId, agentId)` · `ReportLapsed(reportId, agentId)` · `BanAppealed(agentId, human, evidenceCid)` · `BanLifted(agentId, reason)` · `ArbiterChanged(previous, current)` · `MessageAccepted(fromAgent, toAgent, nonce, bodyHash)` · `DealOpened(dealId, fromAgent, toAgent, token, amount, termsHash, deadline)` · `DealDelivered(dealId)` · `DealDisputed(dealId)` · `DealCompleted(dealId)` · `DealCancelled(dealId)` · `DealReclaimed(dealId)` · `DealRefunded(dealId)`

### Errors

`NotBound` · `NotHumanOf` · `AgentNotActive` · `SelfReport` · `OpenReports` · `BelowMinBond` · `BadAmount` · `UnknownReport` · `UnknownDeal` · `WrongStatus` · `WindowClosed` · `WindowOpen` · `OnlyArbiter` · `ArbiterConflict` · `SameHuman` · `NotBonded` · `DeadlinePassed` · `DeadlineNotPassed` · `BadParams` · `TooManyOpenReports` · `AlreadyReported` · `ReportCooldown` · `NoWithdrawal` · `WithdrawalNotReady` · `NotBanned` · `MessageRejected(bytes32 code)` · `NoRenounce`

## GuardedVault additions

| Member | Access | Meaning |
| --- | --- | --- |
| `agentRegistry() view` | | The registry this vault charges (zero for single-agent use) |
| `setAgentRegistry(IAgentRegistry)` | admin (the owner) | Zero unlinks. Emits `AgentRegistrySet` |
| `payForAgent(agentId, payeeId, token, amount, decisionId)` | `SIGNER_ROLE` | `NoAgentRegistry`; `NotOurAgent(agentId)` unless the agent's human holds this vault's admin role; then `AgentRegistry.consume(...)` (`NotSpender`, `AgentBlocked(code)`); then every `pay` rule. Emits `Paid` and `PaidForAgent`. |
| `pay(...)` | `SIGNER_ROLE` | Reverts `UseAgentPath` once an agent registry is linked |
| `PaidForAgent(agentId, payeeId, token, amount, decisionId)` | event | |
| `NoAgentRegistry()`, `UseAgentPath()`, `NotOurAgent(uint256)` | errors | |

A registered-agent deployment uses `payForAgent` exclusively, on-chain as well as in the signer, which also refuses agent requests for other agent ids. The vault's other changes (pausing by the active control key, the last admin) are in [Core contracts](/docs/reference/contracts-core#guardedvault).

## MemoryAnchor additions

| Member | Access | Meaning |
| --- | --- | --- |
| `linkAgent(IAgentRegistry registry, uint256 agentId)` | owner | Gate agent-lane memories on this agent; a zero registry unlinks. Emits `AgentLinked(registry, agentId)`. |
| `agentRegistry()`, `agentId()` | view | The link (zero registry: not linked) |
| `PERM_MEMORY` | `2` | The permission the gate requires |

Once linked, anchoring an agent-lane memory also requires `AgentRegistry.status(agentId)` to be ok (`AgentBlocked(code)`), `agent(agentId).key` to be the signer (`AgentKeyMismatch`) and the `MEMORY` permission (`NoMemoryPermission`). Other lanes are unaffected.

## TestQieId

For local chains, QIE Testnet and the playground. Not for mainnet.

| Function | Effect / reverts |
| --- | --- |
| `claim(name)` | Takes a free (or lapsed) name for the caller; `NameTaken` |
| `transferName(name, to)` | `NotHolder` |
| `lapse(name)` | Simulates an expired free name (resolution reverts); `NotHolder` |
| `resolveCurrency(domain, currency) view` | The holder for currency `"qie"`, zero otherwise; reverts `Metadata:domain expired` if lapsed |

Events: `Claimed(name, holder)`, `Transferred(name, from, to)`, `Lapsed(name)`.
