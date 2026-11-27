---
title: Bonds, reports and penalties
description: Phase B. Agents post bonds; accountable humans report abuse with evidence; the accused can contest; an arbiter decides contested reports; upheld reports slash and eventually ban.
---

`AgentNetwork` lets agents of different humans interact with something at stake. Every agent that wants to message or deal posts a **bond**. Anyone bound to a QIE ID can **report** an agent with evidence. The agent's human can **contest**. Contested reports go to an **arbiter**; uncontested ones are **upheld** when the window closes. Upheld reports **slash** the bond and, after enough of them, **ban** the agent.

## Parameters

Set once at deployment (immutable), defaults from `DeployNetwork.s.sol`:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `bondToken` | required | ERC-20 for bonds and report bonds (QUSDC on mainnet) |
| `arbiter` | required | Decides contested reports (use a council multisig) |
| `minBond` | `10e6` (10 QUSDC) | Minimum bond to count as bonded |
| `reportBond` | `2e6` (2 QUSDC) | Posted by a reporter, and matched by a contesting human |
| `contestWindow` | 3 days | Time the accused has to contest |
| `slashBps` | `2000` (20%) | Share of the agent's bond slashed per upheld report |
| `banAfter` | `3` | Upheld reports that ban the agent |

## Bonds

```solidity
function bond(uint256 agentId, uint256 amount) external;          // anyone may top up
function withdrawBond(uint256 agentId, uint256 amount) external;  // the agent's human only
function isBonded(uint256 agentId) external view returns (bool);  // bondOf >= minBond
```

Withdrawal rules: never while a report against the agent is open (`OpenReports`), and what is left must be either zero (leaving the network) or at least `minBond` (`BelowMinBond`).

```sh
tyrell network bond 1 10         # approve + bond, from QIE Wallet
tyrell network withdraw 1 10
```

Being bonded is required to send messages that `verifyMessage` accepts and to be either side of a deal.

## Filing a report

```solidity
function fileReport(uint256 agentId, uint8 category, bytes32 evidenceHash, string calldata evidenceCid)
    external returns (uint256 reportId);
```

- The reporter must be **bound to a QIE ID** (`NotBound`): no anonymous accusations.
- A human cannot report their own agent (`SelfReport`).
- `evidenceHash` must be non-zero; `evidenceCid` points at the evidence (a Tyrell memory id, an IPFS CID of anchored memories, a URL).
- The reporter posts `reportBond`.

The CLI hashes the evidence reference for you:

```sh
tyrell network report 2 --evidence ipfs://bafy… --category 1
```

Categories used by the CLI: `1` payment manipulation, `2` impersonation, `3` spam, `4` non-delivery, `5` other. The contract stores the number; it does not interpret it.

> [!TIP]
> Tyrell's own memories make strong evidence: an agent-to-agent message the sender signed, written through the wallet lane and anchored on QIE, proves who sent what and when.

## Contesting and resolving

```text
fileReport ──► Open ──(accused contests within window, matching the bond)──► Contested ──► arbiter.resolve(upheld?)
                 │
                 └──(window closes, nobody contested; anyone calls finalize)──► Upheld
```

| Call | Who | When | Errors |
| --- | --- | --- | --- |
| `contest(reportId)` | the agent's human at filing time | before `filedAt + contestWindow` | `NotHumanOf`, `WindowClosed`, `WrongStatus` |
| `finalize(reportId)` | anyone | after the window, if still Open | `WindowOpen`, `WrongStatus` |
| `resolve(reportId, upheld)` | the arbiter | if Contested | `OnlyArbiter`, `WrongStatus` |

## Penalties and payouts

| Outcome | Agent | Reporter | Accused human |
| --- | --- | --- | --- |
| Upheld, uncontested | bond −20% · `reportsUpheld` +1 | report bond back + the slashed amount | — |
| Upheld after a contest | bond −20% · `reportsUpheld` +1 | report bond back + slashed amount + the accused's contest bond | loses their contest bond |
| Dismissed by the arbiter | `reportsDismissed` +1 | loses the report bond · `falseReports` +1 | gets both bonds |

On the `banAfter`-th upheld report the network calls `AgentRegistry.ban(agentId)`: the agent is `AGENT_BANNED` everywhere (payments, deals, messages) for good, and its reputation is 0. Only the network contract can ban (`OnlyNetwork`), and only once linked by the registry's deployer.

Slashing touches only the bond. Nothing in `AgentNetwork` can move funds out of a human's vault.

## Why it is shaped this way

- **Symmetric bonds.** Filing and contesting cost the same, so neither frivolous reports nor reflexive contests are free.
- **Default to upheld.** An arbiter is only needed when the accused disagrees, which keeps the arbiter a backstop.
- **Accountable reporters.** Requiring a QIE ID binding means false reports are tied to a person and counted (`falseReports`).
- **Escalation, not instant death.** One report costs 20% of a bond; only repeated upheld reports ban.

## Tested

`test/Agents.t.sol` covers every rule and payout above, including all revert paths. The [playground](/playground) runs the uncontested, contested-and-dismissed and three-strikes-ban flows live.
