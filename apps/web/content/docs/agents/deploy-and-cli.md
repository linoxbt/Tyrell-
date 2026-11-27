---
title: Deploy and CLI
description: Deploy the agents network once per chain, link your Tyrell deployment, bind your QIE ID, register agents, and run bonds, reports and deals from the CLI.
---

The agents network is two contracts per chain, shared by every human: `AgentRegistry` (phase A) and `AgentNetwork` (phase B). Each human's own Tyrell deployment (lane registry, anchor, ledger, vault) then links to them.

Every write below is an **owner transaction**: the CLI opens a local page and you approve it in QIE Wallet, exactly like `tyrell setup register`. Tyrell's processes never hold your owner key.

## 1. Deploy the network (once per chain)

Usually done once by whoever operates the network on that chain. On mainnet the registry uses the real QIE ID record store; elsewhere a `TestQieId` is deployed.

```sh
tyrell network deploy --arbiter <council multisig> --account tyrell-deployer
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--arbiter <address>` | required | Decides contested reports |
| `--bond-token <address>` | this deployment's token | ERC-20 for bonds (QUSDC on mainnet) |
| `--account <name>` | | Foundry keystore of a funded deployer |
| `--unlocked-sender <address>` | | Local chains only: an unlocked node account |

The script `contracts/script/DeployNetwork.s.sol` reads `BOND_TOKEN`, `ARBITER` and optionally `QIE_ID`, `MIN_BOND`, `REPORT_BOND`, `CONTEST_WINDOW` (seconds), `SLASH_BPS`, `BAN_AFTER` from the environment, deploys, calls `registry.setNetwork(network)` and writes `contracts/deployments/network-<chainId>.json`:

```json
{ "chainId": 1983, "startBlock": 9991700, "qieId": "0x…", "testQieId": true,
  "agentRegistry": "0x…", "agentNetwork": "0x…" }
```

Verification on the QIE explorer is added automatically off local chains.

## 2. Link your deployment

```sh
tyrell network link                       # default: contracts/deployments/network-<chainId>.json
tyrell network link path/to/network.json
```

This writes `agentRegistry`, `agentNetwork`, `qieId` and `testQieId` into your deployment file. Nothing on-chain changes yet.

## 3. Bind your QIE ID

```sh
tyrell agents bind alice.qie
```

On mainnet the CLI resolves the name through the QIE MCP server first and stops if it does not resolve to your owner address. On a test store it claims the name for you. See [QIE ID binding](/docs/agents/qie-id-binding).

## 4. Register this deployment as an agent

```sh
tyrell agents register --label "rent agent" --per-tx 4 --daily 5 --perms pay
tyrell agents link-vault            # vault may charge your agents; vault pays via payForAgent; network may charge for deals
tyrell agents quota 6               # your daily quota, shared by all your agents
tyrell agents payees 1 landlord     # delegate payees (or: tyrell agents any-payee 1 on)
```

`register` without `--key` registers this deployment's agent-lane key and records the new `agentId` in the deployment file. Restart control and the signer after this, so they pick up the agent id. To register another deployment's agent from here, pass its agent-lane key with `--key`.

## 5. Check

```sh
tyrell agents list
```

## Command reference

### `tyrell agents`

| Command | What it does | Contract call |
| --- | --- | --- |
| `list` | Your binding, quota and agents with live status, limits, spend, bond and reputation | reads |
| `bind <qieId>` | Bind your owner account to a QIE ID you hold | `TestQieId.claim` (test chains), `bindQieId` |
| `register --label --per-tx --daily [--key] [--perms] [--any-payee] [--model]` | Register an agent | `registerAgent` |
| `link-vault` | Authorise your vault (and the network) as spenders; point the vault at the registry | `setSpender`, `setAgentRegistry` |
| `quota <daily>` | Your daily quota for the deployment's token | `setQuota` |
| `limits <id> <perTx> <daily>` | Agent limits | `setLimits` |
| `perms <id> <list>` | `pay`, `memory`, `message`, `deal` | `setPermissions` |
| `payees <id> <labels> [--remove]` | Delegate or withdraw payees; `#N` is agent N for deals | `setPayees` |
| `any-payee <id> on\|off` | Allow any registered payee | `setAnyPayee` |
| `revoke <id> [--reason]` | Revoke one agent for good | `revokeAgent` |
| `freeze` / `unfreeze` | Stop or restart all your agents | `freeze` |

Amounts are in token units; the CLI converts with the token's decimals. Every write command accepts `--port <port>` for the local owner page.

### `tyrell network`

| Command | What it does | Contract call |
| --- | --- | --- |
| `deploy --arbiter [...]` | Deploy the network once per chain | `DeployNetwork.s.sol` |
| `link [file]` | Record the network in your deployment file | none |
| `bond <id> <amount>` | Approve and post bond | `approve`, `bond` |
| `withdraw <id> <amount>` | Withdraw bond | `withdrawBond` |
| `report <id> --evidence <ref> [--category]` | Approve and file a report | `approve`, `fileReport` |
| `contest <reportId>` | Approve and contest a report against your agent | `approve`, `contest` |
| `finalize <reportId>` | Uphold an uncontested report after the window | `finalize` |
| `resolve <reportId> [--uphold]` | Arbiter: decide a contested report | `resolve` |
| `deal-open <from> <to> <amount> --terms [--days]` | Approve and escrow a deal | `approve`, `openDeal` |
| `deal confirm\|cancel\|reclaim <dealId>` | Settle a deal | `confirmDeal`, `cancelDeal`, `reclaim` |
| `rep <id>` | Reputation, bond and record | reads |
| `message <toAgent> <text> [--ttl]` | Sign a message with this deployment's agent key | off-chain EIP-712 |
| `verify <file\|json>` | Verify a received message on-chain | `verifyMessage` |

## Configuration in the deployment file

| Field | Written by | Used by |
| --- | --- | --- |
| `agentRegistry`, `agentNetwork`, `qieId`, `testQieId` | `tyrell network link` | CLI, control, signer |
| `agentId` | `tyrell agents register` (this deployment's key) | control (R4a, `payForAgent` simulation), signer (`payForAgent`, agent id check) |

When `agentRegistry` and `agentId` are both present, the deployment pays only through `GuardedVault.payForAgent`. Remove `agentId` to go back to single-agent `pay`.
