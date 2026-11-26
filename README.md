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
| 1 | Contracts | Next |
| 2–7 | Core library, control and storage, agent and payments, detection and response, mainnet, presentation | Planned |

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
pnpm scan-keys:history  # scans every commit for anything shaped like a private key
```

Requires Node 22.21 or newer and pnpm 10.

## Design origin

Tyrell adapts an earlier design by the same author, written for Sui and Walrus. Every line of code in this
repository is new and was written for QIE during the hackathon.

## License

Apache 2.0 (see [LICENSE](LICENSE)).
