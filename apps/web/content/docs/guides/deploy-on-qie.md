---
title: Deploy on QIE
description: Generate keys, deploy the four contracts, register lane keys from QIE Wallet and start the processes on QIE Testnet or Mainnet.
---

This guide takes you from an empty machine to a running Tyrell deployment on QIE. Do it on QIE Testnet (chain 1983) first, then repeat on QIE Mainnet (chain 1990) with a fresh `TYRELL_HOME` so testnet keys are never reused.

## Before you start

| You need | Why |
| --- | --- |
| QIE Wallet in a browser | It becomes the owner of every contract: it registers lane keys and sets the vault cap |
| A little QIEV3 for gas | For a throwaway deployer, the `submitter` key and the `signer` key |
| A Pinata account and JWT (recommended) | Encrypted envelopes are pinned to IPFS. A local directory store also works, but only on the machine that wrote it |
| A model API key | For the Steward agent and the AI judge: `FORTYTWO_API_KEY` (Qwen on Fortytwo), or `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` for any OpenAI-compatible endpoint |
| Mainnet only: QUSDC | The vault's payment token, `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` (6 decimals) |

Gas costs are small. A full deploy of all five contracts is about 6.5M gas; anchoring one memory is about 95k gas (see `contracts/GAS.md`).

> [!WARNING]
> On 2026-11-26 the testnet RPCs `rpc1testnet` to `rpc3testnet` did not answer (see `PROBE.md`). Tyrell's defaults put the working endpoints first. Re-run `pnpm probe` before a deployment to check the network.

## 1. Generate keys

```sh
export TYRELL_HOME=~/.tyrell-testnet
pnpm tyrell setup keys --network testnet --store pinata --gateway https://<you>.mypinata.cloud --new-passphrase
```

This writes one encrypted keystore per role (`user`, `agent`, `wallet`, `control`, `submitter`, `signer`, `data`) to `TYRELL_HOME/keys/`, their public addresses to `keys/addresses.json`, and `config.json` with the network, RPC list, chain id, store and a new random 32-byte account id. `--new-passphrase` creates `TYRELL_HOME/pass` (mode 600) with a random passphrase if no passphrase file exists. Running the command again keeps existing keys.

Fund these addresses with a little QIEV3:

| Address | Pays gas for |
| --- | --- |
| A throwaway deployer (`cast wallet import tyrell-deployer --interactive`) | Deploying the contracts; it holds no role afterwards |
| `submitter` from `keys/addresses.json` | Anchors, ledger relays and quarantine seeds |
| `signer` from `keys/addresses.json` | Vault payments |

## 2. Deploy the contracts

```sh
export PINATA_JWT=...   # never commit it
pnpm tyrell deploy --owner <your QIE Wallet address> --account tyrell-deployer --verify
```

`tyrell deploy` runs `contracts/script/Deploy.s.sol` with Foundry. Every privileged role goes to `--owner` at construction; the submitter and vault signer addresses come from `keys/addresses.json` (the control key needs no vault role: whichever key is the active control-lane key may pause the vault). On a non-mainnet chain without `--token`, it also deploys `TyrellTestUSD` as the payment token. On mainnet the token defaults to QUSDC and any other token is refused:

```sh
pnpm tyrell deploy --owner <your QIE Wallet address> --account tyrell-deployer \
  --token 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5 --verify
```

`--verify` verifies sources on the QIE explorer (Blockscout). If verification through Foundry fails, use the explorer's web form with flattened sources (`forge flatten src/<Contract>.sol`), compiler 0.8.28, optimizer 200 runs, EVM version `shanghai`.

The deployment is written to `contracts/deployments/<chainId>.json` and copied to `TYRELL_HOME/deployment-<chainId>.json`.

## 3. Register lane keys from QIE Wallet

```sh
pnpm tyrell setup register --mint 10000000     # testnet: also mints 10 tUSD into the vault
```

The CLI serves a local page on `127.0.0.1`, prints its URL and lists the owner transactions still missing:

- `LaneRegistry.addLaneKey` for each of the four lanes whose key is not yet active;
- `GuardedVault.setGlobalDailyCap` if the cap differs from `--daily-cap` (default `5000000` base units, 5 tokens at 6 decimals);
- testnet only, with `--mint`: `TyrellTestUSD.mint` to top the vault up to that many base units.

Open the page in the browser that has QIE Wallet. It discovers QIE Wallet over EIP-6963, switches to the right chain and sends each transaction for you to approve. The CLI polls the chain and exits when everything is registered.

> [!NOTE]
> If a lane already has a different active key, `setup register` refuses and tells you to rotate it with `tyrell revoke --lane <lane> --rotate`.

## 4. Fund the vault and check the worst case

On mainnet, send the demo amount of QUSDC from QIE Wallet to the `guardedVault` address, then:

```sh
pnpm tyrell check caps --max 20
```

This computes the most the vault can lose in one UTC day whatever happens to every key except the owner's: the minimum of the vault-wide daily cap, the sum of active payees' daily caps and the vault balance. It exits with code 4 unless that is at most `--max` token units. Do not fund more until it prints `"ok": true`.

## 5. Start the processes

```sh
pnpm tyrell control start &     # control, submitter and data keys
pnpm tyrell signer start &      # vault signer key only
pnpm tyrell ingest start &      # wallet key only
```

Control refuses to start unless each lane has exactly one active key. Run each process as its own OS user in production and set `TYRELL_STRICT_KEYS=1` (see [Architecture](/docs/get-started/architecture#processes-and-keys)).

## 6. Add payees and run the agent

```sh
pnpm tyrell payee add --label landlord --qie-id landlord.qie --cap 5 --daily 5   # mainnet
pnpm tyrell payee add --label landlord --address 0x… --cap 5 --daily 5          # testnet
pnpm tyrell say "pay rent to landlord, 5 QUSDC, on the 1st"
export FORTYTWO_API_KEY=...      # or LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
pnpm tyrell steward "pay this month's rent"
```

See [Payees](/docs/guides/payees) and [Steward agent](/docs/guides/steward-agent).

## 7. Verify the deployment

```sh
pnpm tyrell status                                              # contracts, lane keys, head, digest, classes, seeds
pnpm tyrell rebuild --fresh --out /tmp/rebuild.sqlite
pnpm tyrell verify --head <block>                               # live digest == fresh rebuild
pnpm tyrell drill signer-leak                                   # the vault reverts an unauthorised pay on-chain
pnpm tyrell attack run --markdown                               # 10 of 10
pnpm tyrell evidence                                            # explorer links for contracts and key transactions
```

## Mainnet checklist

Before a mainnet run:

- [ ] The testnet run passed, and `tyrell verify --head <block>` matched there.
- [ ] `pnpm probe` re-run today; mainnet RPCs answer and the EVM is still Shanghai.
- [ ] A fresh home for mainnet: `export TYRELL_HOME=~/.tyrell-mainnet`.
- [ ] The vault holds only the demo amount, and `tyrell check caps` passes.
- [ ] `pnpm scan-keys:history` finds no key anywhere in Git history.

## If something goes wrong

| Situation | Action |
| --- | --- |
| A lane key may have leaked | `pnpm tyrell revoke --lane <lane>` (owner approves in QIE Wallet), then `--rotate` to register a fresh key |
| Payments look wrong | Call `GuardedVault.pause()` from QIE Wallet or with the active control-lane key; only the owner can `unpause()` |
| You want the money back | `GuardedVault.withdraw(token, to, amount)` from QIE Wallet (owner only) |
| The local database is damaged | Stop control and run `tyrell rebuild --fresh` |
