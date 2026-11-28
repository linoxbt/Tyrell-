---
title: Playground
description: Run the same attack on an AI agent with an ordinary wallet and one protected by Tyrell, then run 38 checks against the real contracts. In your browser, no wallet, no login.
---

The [playground](/playground) shows what Tyrell does in about a minute, for anyone. It is one page in three parts:

1. **The demo:** a hacker attacks two AI agents that pay your rent. One pays from an ordinary wallet; the other is protected by Tyrell. You see who gets the money, and why.
2. **The proof:** 38 checks run against Tyrell's real contract code in your browser.
3. **For developers:** every test in the repository, and sandboxes for the safety rules.

## The demo

The demo runs a real model, Qwen 3.8 on [Fortytwo](https://fortytwo.network), against a poisoned memory. Pick an attack (a poisoned token name, an NFT with hidden instructions, a look-alike address) or write your own (step 1), choose how powerful the hacker is (step 2), then **Run the attack** (step 3). Behind the scenes:

1. The **AI judge** reads the attacker's text with the sentinel's fixed prompt, next to the rule-based scorer; the incident score is the higher of the two.
2. **Steward on Tyrell** gets the user's instruction and the poisoned memory, labelled, with its real system prompt and tools. Its `propose_payment` goes to the real policy engine, whose verdict it reads back.
3. A **plain agent** gets the same model and the same memories with no labels, no policy and a normal wallet.

How powerful the hacker is:

- **Can only send messages:** the model as it is. In our recorded runs Qwen 3.8 spotted all three attacks on its own, with or without Tyrell, and the judge scored them 98 to 100.
- **Has taken over the AI:** the attacker sits between the agents and the model (a stolen API route, a poisoned proxy or a backdoored model) and rewrites every payment the model proposes to the attacker's address. The real model still runs; the page shows what it proposed and what the hijacker turned it into. This is the case Tyrell exists for: the plain agent pays the attacker, Steward on Tyrell is blocked with `UNKNOWN_RECIPIENT` every time.

The results show both outcomes in plain words (who got the money, and why), with the AI conversations and the blockchain transactions one click away. Both outcomes run on Tyrell's contracts in your browser: the guarded vault pays only the registered landlord (and refuses the attacker even when asked directly), while the plain wallet sends whatever the model asked for. The model call runs on the site's server, because the model API takes no browser calls and the key must stay secret; nothing about the outcome depends on the model.

A live run usually takes 30 to 60 seconds. It runs inside a 90-second budget shared by every model call of the run, and each agent call is capped at 2,048 output tokens. When live runs are off, busy or fail, the demo replays real runs recorded with `pnpm record:ai`, and says so in a plain note. It never shows a failed run as a result:

| What happened | The server answers | The page |
| --- | --- | --- |
| A live run finished | 200 with the result | Shows it |
| The model failed (out of credits, rate-limited, too slow, an error) | 502 `model_failed` | Replays the recording |
| Too many runs | 429 `rate_limited` | Replays the recording |
| Live runs are off (no key) | No run | Replays the recording |
| Anything else (a timeout page, a security challenge, a response that is not the expected JSON) | Whatever it was | Replays the recording |

### Limits

The demo spends the site owner's model credits, so it guards them:

- **Same site only.** A run must be a `POST` with `Content-Type: application/json` from the site itself: a cross-site `Sec-Fetch-Site` or a foreign `Origin` gets 403, so other sites cannot make their visitors' browsers spend runs.
- **Rate limits.** 4 runs per visitor per 10 minutes and 3 runs per minute for the whole site. Preset results are cached for 30 minutes.
- **Shared limits (optional).** The counters live in each server instance's memory unless `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set (Vercel KV or Upstash Redis over REST; `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work), which shares them across instances. If the store fails, the in-memory limits apply.
- **Spend limit.** The provider's spend limit on the key is the real ceiling: set one.

To run it yourself, set `FORTYTWO_API_KEY` in the web app's environment (for example in Vercel's project settings) and redeploy.

## The proof: 38 checks

| Group | Contracts | What it proves |
| --- | --- | --- |
| Lane keys and memory provenance | `LaneRegistry`, `MemoryAnchor` | Only the active key of a lane can anchor that lane's memories; forged lanes, strangers, replays and revoked keys are refused |
| Payees and the guarded vault | `TyrellLedger`, `GuardedVault`, `TyrellTestUSD` | Only the user lane registers payees; the vault pays only registered payees within caps; a stolen signer key cannot pay anyone new; quarantine suspends a payee |
| Agents network, phase A | `TestQieId`, `AgentRegistry`, `GuardedVault.payForAgent` | QIE ID binding, delegated payees, per-agent limits, one quota shared by a human's agents, freeze, revoke, and every agent stopping when the QIE ID moves or lapses |
| Agents network, phase B | `AgentNetwork` | Bonds, signed agent messages, escrowed deals, accountable reports, slashing and bans only by the arbiter, appeals, with reputation at each step |
| Off-chain checks | policy engine, sentinel scorer | The same pure code the processes run: attack proposals blocked, poisoned names scored |

Press **Run the checks**; each group is shown as the claim it proves, and opens to list its checks. The same suite runs in CI.

## How it works

- **EVM:** `@ethereumjs/evm`, Shanghai hard fork (QIE supports PUSH0 but not Cancun opcodes), chain id 1990.
- **Contracts:** `pnpm gen:playground` copies ABIs and bytecode from `contracts/out` into `apps/web/lib/playground/artifacts.json`, together with verbatim copies of the policy engine and the sentinel scorer. A test fails if the copies drift from the source.
- **Signatures:** real secp256k1 keys sign EIP-712 data (memories, payees, quarantine seeds, agent messages); the contracts recover and check them.
- **Time:** each call carries a block timestamp, so checks can cross a UTC day (daily caps and quotas) or a 3-day contest window.
- **Same suite in CI:** `apps/web/test/playground.test.ts` runs the identical suite in Node on every `pnpm test`.

## For developers

Two panels at the bottom of the page:

**Poke at the safety rules yourself:**

- **Sentinel:** type a token name and see the rule score and which rules matched.
- **Policy engine:** play a compromised model; change recipient, label, amount, token, endpoint agreement or the proposing agent's state and watch which rule refuses.
- **QIE ID:** resolve any QIE ID against the real record store on QIE Mainnet, the contract `AgentRegistry` binds humans against.

**Every test in the repository** shows the repository's full TypeScript and Foundry test suites as last recorded with `pnpm report:tests` (including end-to-end runs of control, signer, Steward and the vault on anvil), the attack-set results, and a link to the console's recorded end-to-end run.

## Run it locally

```sh
pnpm install
pnpm gen:playground      # after changing contracts
pnpm web:dev             # http://localhost:3000/playground
```
