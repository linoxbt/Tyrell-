---
title: Quickstart
description: Install Tyrell, run the test suites, and open the web console against the recorded demo or your own control process.
---

This page gets the repository running on your machine and shows you the system working end to end on a local chain. To deploy to QIE, continue with [Deploy on QIE](/docs/guides/deploy-on-qie) afterwards.

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 22.21 or later | Set in `package.json` `engines` |
| pnpm | 10 | The repository is a pnpm workspace |
| Git | any recent | Clone with submodules (OpenZeppelin and forge-std) |
| Foundry | installed from npm | `@foundry-rs/forge` is a dev dependency of `contracts/`; you do not need a global install |

## Install

```sh
git clone --recurse-submodules https://github.com/linoxbt/Tyrell-.git tyrell
cd tyrell
pnpm install
```

`pnpm install` also points Git at `.githooks`, which installs a pre-commit hook that scans staged changes for private keys.

## Run the tests

```sh
pnpm contracts:test     # Foundry unit, fuzz and invariant tests
pnpm test               # TypeScript tests, including end-to-end runs on a local anvil chain
pnpm coverage           # enforces 100% on the verifier and the policy engine
```

The TypeScript suite starts its own anvil chains, deploys the contracts from the Foundry build output and runs the full system: control, Steward with a scripted model, the ingest worker and the signer. Notable end-to-end tests:

| Test | What it proves |
| --- | --- |
| The poison-to-clean loop | A poisoned token name becomes an untrusted memory and an incident, a payment proposal citing it is blocked, quarantine excludes it and its descendants, and the next payment is allowed. |
| M1 acceptance run | The same story across real processes talking over Unix sockets. |
| T-19 | The web console's blast radius matches `tyrell blast` for the same seed. |
| Wallet test | Connects a test QIE Wallet, signs in, reads the owner role and revokes a lane key on-chain from the browser. |

## Open the web console

```sh
pnpm web:dev
```

Open `http://localhost:3000`. Without a live control process the web app serves `apps/web/public/snapshot.json`, a recorded run with a poisoned token, a blocked payment and an active quarantine. The [console](/console) shows its memories, lineage graph, blast radius per seed, decisions and incidents.

> [!NOTE]
> The hosted demo at `tyrell-mu.vercel.app` runs in this read-only mode and says **Recorded demo · read-only** above the tabs. The processes that hold keys never run on the web host. For live data, run the console next to control with `TYRELL_API_URL` and `TYRELL_API_TOKEN` (see [Web console and wallet](/docs/guides/web-console-and-wallet#data-modes)).

## Try it on QIE Testnet

The short version of [Deploy on QIE](/docs/guides/deploy-on-qie):

```sh
pnpm tyrell setup keys --network testnet --store pinata --gateway https://<you>.mypinata.cloud --new-passphrase
cast wallet import tyrell-deployer --interactive      # a throwaway, funded deployer
export PINATA_JWT=...                                 # never commit it
pnpm tyrell deploy --owner <your QIE Wallet address> --account tyrell-deployer --verify
pnpm tyrell setup register --mint 10000000            # QIE Wallet page: lane keys, vault cap, test funds
pnpm tyrell control start &                           # control, submitter and data keys
pnpm tyrell signer start &                            # vault signer key only
pnpm tyrell ingest start &                            # wallet key only
pnpm tyrell payee add --label landlord --qie-id landlord.qie --cap 5 --daily 5
pnpm tyrell say "pay rent to landlord, 5 QUSDC, on the 1st"
export LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=...   # any OpenAI-compatible endpoint
pnpm tyrell steward "pay this month's rent"           # agent key only; proposes, never signs
```

Run the ten attacks against it, with the model scripted to be fully compromised (see [Attack set](/docs/guides/attack-set)):

```sh
pnpm tyrell attack run --markdown
```

Then watch it live:

```sh
TYRELL_API_URL=http://127.0.0.1:7878 pnpm web:dev
```

Control serves a read-only view of its projection on `127.0.0.1:7878` (set `TYRELL_API_PORT` to change it). The web app proxies it server-side, so the browser never talks to control directly.

> [!WARNING]
> QIE ID is deployed on mainnet only. On testnet, add payees with `--address` instead of `--qie-id`.

## Next steps

- [How it works](/docs/get-started/how-it-works): lanes, envelopes, lineage and trust classes.
- [Steward agent](/docs/guides/steward-agent): connect your own model.
- [Web console and wallet](/docs/guides/web-console-and-wallet): connect QIE Wallet and manage lane keys from the browser.
