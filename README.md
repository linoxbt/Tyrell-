# Tyrell

Tyrell is a provenance and quarantine layer between an AI agent and its memory. Payments are enforced by
QIE smart contracts instead of by the model. Every memory is signed by a lane key registered on-chain and
anchored on QIE. If a source turns out to be poisoned, Tyrell shows everything it reached, keeps it out of
the agent's reasoning and rebuilds a clean state from the chain alone.

Built for QIE Mainnet Hackathon 3.0, track AI + Autonomous Agents.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Probe and scaffold | Done: see [PROBE.md](PROBE.md). P-9 (wallet) and P-10 (Pinata) need a run on the owner's side |
| 1 | Contracts | Contracts and 81 tests done ([GAS.md](contracts/GAS.md)); testnet deploy and explorer verification need a funded deployer key |
| 2 | Core library | Done: envelope, EIP-712, verifier, lineage and quarantine closure, blast radius, digest, policy engine R0–R5; verifier and policy engine at 100% branch coverage |
| 3 | Control and storage | Done on a local chain: `tyrell setup`, deploy, control (encrypt, pin, anchor, index), `rebuild --fresh`, `verify`; testnet run needs a funded deployer and a Pinata JWT |
| 4–7 | Agent and payments, detection and response, mainnet, presentation | Planned |

## Repo layout

```
contracts/   Foundry project: LaneRegistry, MemoryAnchor, TyrellLedger, GuardedVault (Phase 1)
packages/    core (envelope, verifier, lineage, policy), chain (QIE chain + RPCs), storage, ipc
apps/        cli, control, ingest, steward, signer (web in Phase 7)
scripts/     probe.ts (Phase 0), probe-wallet.html (P-9), scan-keys.mjs (pre-commit key scan)
```

## Quick start

```sh
pnpm install            # also points git at .githooks (pre-commit key scan)
cp .env.example .env    # never put a private key in it
pnpm probe              # re-runs the Phase 0 probe and rewrites PROBE.md
pnpm contracts:test     # Foundry unit, fuzz and invariant tests
pnpm test               # TypeScript tests (pnpm coverage enforces NFR-04)
pnpm vectors            # regenerate the TypeScript/Solidity cross-check vectors
pnpm scan-keys:history  # scans every commit for anything shaped like a private key
```

Requires Node 22.21 or newer and pnpm 10. Foundry comes from npm (`@foundry-rs/forge`); clone with `--recurse-submodules` for forge-std.

## Running on QIE testnet

```sh
pnpm tyrell setup keys --network testnet --store pinata --gateway https://<you>.mypinata.cloud --new-passphrase
#   prints seven public addresses; keys stay encrypted in ~/.tyrell/keys
#   fund the submitter address with testnet QIEV3 (https://qie.digital/faucet)
cast wallet import tyrell-deployer --interactive      # a throwaway, funded deployer
export PINATA_JWT=...                                 # never commit it
pnpm tyrell deploy --owner <your QIE Wallet address> --account tyrell-deployer --verify
pnpm tyrell setup register                            # open the page, sign 5 transactions in QIE Wallet
pnpm tyrell control start &                           # the control process
pnpm tyrell say "pay rent to landlord, 5 QUSDC, on the 1st"
pnpm tyrell status
pnpm tyrell verify --head <block>                     # live digest == fresh rebuild from chain + IPFS
```

## Design origin

Tyrell adapts an earlier design by the same author, written for Sui and Walrus. Every line of code in this
repository is new and was written for QIE during the hackathon.

## License

Apache 2.0 (see [LICENSE](LICENSE)).
