---
title: Playground
description: Tyrell's compiled contracts running live in your browser, with real signatures: 34 checks you can run, inspect step by step and re-run. No wallet, no login.
---

The [playground](/playground) is the fastest way to see Tyrell's guarantees hold. It loads the exact bytecode the contracts compile to into an EVM running inside your browser, deploys them, signs with real keys and tries to break them. Every check is an assertion; if one fails, the page says so.

## What runs

| Group | Contracts | What it proves |
| --- | --- | --- |
| Lane keys and memory provenance | `LaneRegistry`, `MemoryAnchor` | Only the active key of a lane can anchor that lane's memories; forged lanes, strangers, replays and revoked keys are refused |
| Payees and the guarded vault | `TyrellLedger`, `GuardedVault`, `TyrellTestUSD` | Only the user lane registers payees; the vault pays only registered payees within caps; a stolen signer key cannot pay anyone new; quarantine suspends a payee |
| Agents network, phase A | `TestQieId`, `AgentRegistry`, `GuardedVault.payForAgent` | QIE ID binding, delegated payees, per-agent limits, one quota shared by a human's agents, freeze, revoke, and every agent stopping when the QIE ID moves or lapses |
| Agents network, phase B | `AgentNetwork` | Bonds, signed agent messages, escrowed deals, accountable reports, slashing, arbitration and the three-strikes ban, with reputation at each step |
| Off-chain checks | policy engine, sentinel scorer | The same pure code the processes run: attack proposals blocked, poisoned names scored |

Click any check to see each step: deployments, transactions with decoded events, signatures, reads, time jumps and the reverts that were expected (decoded to their custom error and code).

## How it works

- **EVM:** `@ethereumjs/evm`, Shanghai hard fork (QIE supports PUSH0 but not Cancun opcodes), chain id 1990.
- **Contracts:** `pnpm gen:playground` copies ABIs and bytecode from `contracts/out` into `apps/web/lib/playground/artifacts.json`, together with verbatim copies of the policy engine and the sentinel scorer. A test fails if the copies drift from the source.
- **Signatures:** real secp256k1 keys sign EIP-712 data (memories, payees, quarantine seeds, agent messages); the contracts recover and check them.
- **Time:** each call carries a block timestamp, so checks can cross a UTC day (daily caps and quotas) or a 3-day contest window.
- **Same suite in CI:** `apps/web/test/playground.test.ts` runs the identical suite in Node on every `pnpm test`.

## Try it yourself

The second tab lets you poke at the off-chain pieces:

- **Sentinel:** type a token name and see the rule score and which rules matched.
- **Policy engine:** play a compromised model; change recipient, label, amount, token, endpoint agreement or the proposing agent's state and watch which rule refuses.
- **QIE ID:** resolve any QIE ID against the real record store on QIE Mainnet, the contract `AgentRegistry` binds humans against.

## Recorded runs

The third tab shows the repository's full TypeScript and Foundry test suites as last recorded with `pnpm report:tests` (including end-to-end runs of control, signer, Steward and the vault on anvil), the attack-set results, and a link to the console's recorded end-to-end run.

## Run it locally

```sh
pnpm install
pnpm gen:playground      # after changing contracts
pnpm web:dev             # http://localhost:3000/playground
```
