# Mainnet runbook (Phase 6)

Everything below runs on your machine: the owner steps need QIE Wallet in a browser. Do the testnet
run first (README, "Running on QIE testnet") and keep this order. Money at risk is capped by design:
the vault holds the demo amount only, and `tyrell check caps` must pass before you fund it (NFR-08).

## 0. Before you start

- [ ] M1 passed on testnet; `pnpm tyrell verify --head <block>` matched there.
- [ ] `pnpm probe` re-run today; PROBE.md committed. Mainnet RPCs 1-5 answer, EVM is still Shanghai.
- [ ] QUSDC confirmed in the QIE Discord as the official stablecoin (probe P-7 matched the report and
      the QIE MCP token list includes it, but the spec asks for a human confirmation).
- [ ] A fresh home for mainnet, so testnet keys are never reused: `export TYRELL_HOME=~/.tyrell-mainnet`.
- [ ] The attacker address for the demo is one you control, and it never receives real funds.
- [ ] At least two *different* mainnet RPC URLs in `config.json` (the defaults are), plus a third for
      tie-breaks; every process refuses to start with the same URL twice.
- [ ] Keystores from an older Tyrell: run `pnpm tyrell keys migrate` first (they are refused otherwise).

## 1. Keys and gas

```sh
export TYRELL_HOME=~/.tyrell-mainnet
pnpm tyrell setup keys --network mainnet --store pinata --gateway https://<you>.mypinata.cloud --new-passphrase
```

`--new-passphrase` writes one random passphrase per role to `TYRELL_HOME/pass.d/<role>` (mode 600). On
mainnet a shared passphrase file is refused, and a process that can open another role's key (read both
its key file and its passphrase) aborts at startup. For the real run, give each process its own OS user
that owns only its keys and passphrases:

| Process | Keys and passphrases it owns |
| --- | --- |
| `control start` | `control`, `submitter`, `data` |
| `signer start` | `signer` |
| `ingest start` | `wallet` |
| `steward` | `agent` |
| your own CLI (`say`, `payee`, `release`, `quarantine`) | `user` |

Keep every file `chmod 600`; a key, passphrase or token file readable by its group or others is refused.
Point a process at its passphrase with `KEYSTORE_PASSPHRASE_FILE_<ROLE>` if it lives outside `pass.d`.
Give `control.sock` group access with `TYRELL_SOCKET_MODE=660` and a group shared by the process users;
requests that make control act are signed by the caller's lane key either way.

Send a little QIEV3 for gas (a few cents' worth each; contracts/GAS.md: a full deploy is about 6.5M gas,
the agents network another 8.1M, an anchor about 95k) to:

| Address | Why |
| --- | --- |
| a throwaway deployer (`cast wallet import tyrell-deployer --interactive`) | deploys the contracts, holds nothing afterwards |
| `submitter` from `keys/addresses.json` | pays gas for anchors, ledger relays and quarantine seeds |
| `signer` | pays gas for vault payments |
| `attacker` (created by `tyrell attack run`) | deploys the attack-set contracts; never receives QUSDC |

## 2. Deploy and verify

```sh
export PINATA_JWT=...
pnpm tyrell deploy --owner <your QIE Wallet address> --account tyrell-deployer --verify
```

On chain 1990 the token defaults to QUSDC (`0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`) and the script
refuses any other, so `--token` is only needed to be explicit.

If Blockscout verification through forge fails, use the explorer's web form with flattened sources
(`forge flatten src/<Contract>.sol`), compiler 0.8.28, optimizer 200 runs, EVM version shanghai.
Verified source on all four contracts is a submission requirement.

### Agents network (optional, once per chain)

Only if you run the agents network on mainnet and nobody has deployed it yet. On chain 1990 the script
uses QUSDC bonds and the real QIE ID record store (`0x8777d01d509D0eA71FB38F88F79867da558d5018`) and
refuses anything else, and the council address is required:

```sh
pnpm tyrell network deploy --arbiter <arbiter> --admin <council multisig> --account tyrell-deployer
pnpm tyrell network link
```

Then, from QIE Wallet: `agents bind`, `agents register`, `agents link-vault` (see the docs, Agents network
→ Deploy and CLI). After `link-vault` the vault pays only through `payForAgent`.

## 3. Owner setup in QIE Wallet

```sh
pnpm tyrell setup register --daily-cap 5000000     # lane keys + vault cap of 5 QUSDC per day
```

Then send the demo amount (for example 10 QUSDC) from QIE Wallet to the `guardedVault` address, and:

```sh
pnpm tyrell check caps --max 20                    # must print "ok": true before anything else
```

## 4. Run the processes

```sh
pnpm tyrell control start &
pnpm tyrell signer start &
pnpm tyrell ingest start &
pnpm tyrell payee add --label landlord --qie-id <landlord>.qie --cap 5 --daily 5
pnpm tyrell say "pay rent to landlord, 5 QUSDC, on the 1st"
pnpm tyrell status                   # vault balance, incidents, and a warning if the submitter is low on gas
```

Control's read-only view API (`127.0.0.1:7878`) needs its bearer token, `TYRELL_HOME/api-token`
(created on first start). To watch the run in the console on the same machine:

```sh
TYRELL_API_URL=http://127.0.0.1:7878 TYRELL_API_TOKEN=$(cat $TYRELL_HOME/api-token) pnpm web:dev
```

To show it on the hosted console instead, expose the API through a tunnel that rewrites the `Host`
header to `127.0.0.1` (control refuses any other host), and set `TYRELL_API_URL` and `TYRELL_API_TOKEN`
in the Vercel project. The view contains decrypted memory bodies: only do this for demo data.

## 5. M1 and M2 on mainnet (record the video here)

```sh
# send the poisoned token from the attacker (see the attack set, variant 1), then:
pnpm tyrell incidents
pnpm tyrell steward "pay this month's rent"                     # BLOCK with the lineage
pnpm tyrell quarantine --source <poison token> --reason "..."    # preview, confirm
pnpm tyrell blast <seedId> --mermaid                             # also prints the console link
pnpm tyrell steward "pay this month's rent"                     # ALLOW, Paid on the explorer
pnpm tyrell drill signer-leak                                    # vault reverts on-chain
pnpm tyrell revoke --lane wallet --rotate                        # optional (cut order: keep revoke)
pnpm tyrell rebuild --fresh --out /tmp/rebuild.sqlite && pnpm tyrell verify --head <block>
```

## 6. Attack set and evidence

```sh
pnpm tyrell attack run --markdown > ATTACKS.md                   # must say 10 of 10
pnpm tyrell evidence                                             # links for the submission form
pnpm tyrell snapshot --out apps/web/public/snapshot.json          # memory contents left out; add
                                                                 # --include-bodies only for demo data
pnpm scan-keys:history                                           # no key anywhere in git history
```

## If something goes wrong

- A key may have leaked: `pnpm tyrell revoke --lane <lane>` (owner signs), then `--rotate`.
- Payments look wrong: `GuardedVault.pause()` from QIE Wallet or the active control-lane key stops all
  of them (the vault follows a rotated control key automatically); only the owner can unpause.
- Take the money back: `GuardedVault.withdraw(token, to, amount)` from QIE Wallet (owner only).
