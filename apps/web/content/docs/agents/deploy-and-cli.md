---
title: Deploy and CLI
description: Deploy the agents network once per chain, link your Tyrell deployment, bind your QIE ID, register agents, and run bonds, reports and deals from the CLI.
---

The agents network is two contracts per chain, shared by every human: `AgentRegistry` (phase A) and `AgentNetwork` (phase B). Each human's own Tyrell deployment (lane registry, anchor, ledger, vault) then links to them.

Every write below is an **owner transaction**: the CLI opens a local page and you approve it in QIE Wallet, exactly like `tyrell setup register`. Tyrell's processes never hold your owner key.

## 1. Deploy the network (once per chain)

Usually done once by whoever operates the network on that chain. On mainnet the registry uses the real QIE ID record store and bonds are in QUSDC (the script refuses anything else there); elsewhere a `TestQieId` is deployed.

```sh
tyrell network deploy --arbiter <arbiter> --admin <council multisig> --account tyrell-deployer
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--arbiter <address>` | required | Decides contested reports and disputed deals |
| `--admin <address>` | the arbiter (required on mainnet) | Owner of the network: a council that can replace the arbiter |
| `--bond-token <address>` | this deployment's token | ERC-20 for bonds (QUSDC on mainnet) |
| `--account <name>` | | Foundry keystore of a funded deployer |
| `--unlocked-sender <address>` | | Local chains only: an unlocked node account |

The script `contracts/script/DeployNetwork.s.sol` reads these from the environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BOND_TOKEN` | QUSDC on mainnet (and must be) | Bond token |
| `ARBITER` | required | The arbiter |
| `ADMIN` | `ARBITER` off mainnet; required on mainnet | The network's owner (council) |
| `QIE_ID` | the real store on mainnet (and must be); a new `TestQieId` elsewhere | QIE ID record store |
| `MIN_BOND`, `REPORT_BOND` | `10e6`, `2e6` | Base units |
| `CONTEST_WINDOW`, `RULE_WINDOW` | 3 days, 7 days | Seconds |
| `SLASH_BPS`, `BAN_AFTER` | `2000`, `3` | |

It deploys, calls `registry.setNetwork(network)` and writes `contracts/deployments/network-<chainId>.json`:

```json
{ "chainId": 1983, "startBlock": 9991700, "qieId": "0x…", "admin": "0x…", "arbiter": "0x…",
  "testQieId": true, "agentRegistry": "0x…", "agentNetwork": "0x…" }
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
tyrell agents register --label "rent agent" --per-tx 4 --daily 5      # permissions default to pay,memory
tyrell agents link-vault            # vault may charge your agents and pays only via payForAgent; agent memories
                                    # need the memory permission; the network may charge for deals
tyrell agents quota 6               # your daily quota, shared by all your agents
tyrell agents payees 1 landlord     # delegate payees (or: tyrell agents any-payee 1 on)
```

`register` without `--key` registers this deployment's agent-lane key: the CLI signs the key's consent with it, sends the registration, checks the new id is yours with that key, and records `agentId` in the deployment file. Restart control and the signer after `link-vault`, so they pick up the agent id. To register another deployment's agent from here, run `tyrell agents consent <your owner address>` on that deployment and pass its output with `--key`, `--key-sig` and `--sig-deadline` (see [Registering an agent](/docs/agents/agents-and-limits#registering-an-agent)).

Every owner command waits for each transaction's receipt (found on-chain by sender, target and calldata), stops at the first revert and says so, and gives up after 10 minutes (`TYRELL_OWNER_TIMEOUT`, in seconds) if the wallet never sends, instead of waiting forever.

## 5. Check

```sh
tyrell agents list
```

## Command reference

### `tyrell agents`

| Command | What it does | Contract call |
| --- | --- | --- |
| `list` | Your binding, quota and agents with key, token, live status, limits, spend, bond (the bond that counts; `pendingWithdrawal` when one is waiting) and reputation | reads (`agentsView`, `stats`) |
| `bind <qieId>` | Bind your owner account to a QIE ID you hold | `TestQieId.claim` (test chains), `bindQieId` |
| `consent <human> [--ttl]` | Sign, with this deployment's agent key, its consent to be `<human>`'s agent; prints JSON | off-chain EIP-712 |
| `register --label --per-tx --daily [--key --key-sig --sig-deadline] [--perms] [--any-payee] [--model]` | Register an agent (default permissions `pay,memory`) | `registerAgent` |
| `link-vault` | Authorise your vault (and the network) as spenders; vault pays only via `payForAgent`; gate agent memories on this agent | `setSpender`, `setAgentRegistry`, `linkAgent` |
| `rotate-consent <id> <human> [--ttl]` | Sign, with this deployment's agent-lane key, its consent to become agent `<id>`'s key for `<human>`; prints JSON | off-chain EIP-712 |
| `rotate-key [id] [--key --key-sig --sig-deadline]` | Replace an agent's key in place (default: this deployment's agent and its current agent-lane key); waits until the registry shows the new key | `rotateAgentKey` |
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
| `deploy --arbiter [--admin] [...]` | Deploy the network once per chain | `DeployNetwork.s.sol` |
| `link [file]` | Record the network in your deployment file | none |
| `bond <id> <amount>` | Approve and post bond | `approve`, `bond` |
| `request-withdrawal <id> <amount>` | Step 1 of taking bond out | `requestWithdrawal` |
| `withdraw <id>` | Step 2, one contest window later | `withdrawBond` |
| `cancel-withdrawal <id>` | Keep the bond after all | `cancelWithdrawal` |
| `report <id> --evidence <ref> [--category]` | Approve and file a report | `approve`, `fileReport` |
| `contest <reportId>` | Approve and contest a report against your agent | `approve`, `contest` |
| `finalize <reportId>` | Close an uncontested report after the window (reporter's bond back, no penalty) | `finalize` |
| `lapse <reportId>` | Close a contested report the arbiter did not rule on in time | `lapse` |
| `resolve <reportId> [--uphold]` | Arbiter: decide a contested report | `resolve` |
| `appeal <id> --evidence <ref>` | Ask the arbiter to lift your agent's ban | `appeal` |
| `unban <id> --reason <text>` | Arbiter: lift a ban | `unban` |
| `set-arbiter <address>` | Network owner (council): replace the arbiter | `setArbiter` |
| `deal-open <from> <to> <amount> --terms [--days]` | Approve and escrow a deal | `approve`, `openDeal` |
| `deal confirm\|dispute\|reclaim <dealId>` | Payer: settle a deal | `confirmDeal`, `disputeDeal`, `reclaim` |
| `deal deliver\|cancel\|claim <dealId>` | Payee: settle a deal | `deliver`, `cancelDeal`, `claim` |
| `deal lapse <dealId>` | Anyone: close a dispute the arbiter did not decide in time | `lapseDeal` |
| `resolve-deal <dealId> [--pay-payee]` | Arbiter: decide a disputed deal (default: refund the payer) | `resolveDeal` |
| `rep <id>` | Reputation, bond, pending withdrawal and record | reads |
| `message <toAgent> <text> [--ttl]` | Sign a message with this deployment's agent key | off-chain EIP-712 |
| `verify <file\|json> [--accept]` | Verify a received message on-chain; `--accept` records it so it can't be replayed | `verifyMessage`, `acceptMessage` |

## Configuration in the deployment file

| Field | Written by | Used by |
| --- | --- | --- |
| `agentRegistry`, `agentNetwork`, `qieId`, `testQieId` | `tyrell network link` | CLI, control, signer |
| `agentId` | `tyrell agents register` (this deployment's key) | control (R4a, `payForAgent` simulation), signer (`payForAgent`, agent id check) |

When `agentRegistry` and `agentId` are both present, the deployment pays only through `GuardedVault.payForAgent`. Once `link-vault` has pointed the vault at the registry, that is also enforced on-chain: plain `pay` reverts with `UseAgentPath`. Going back to single-agent `pay` takes the owner unlinking the vault (`GuardedVault.setAgentRegistry(address(0))`) and removing `agentId`.
