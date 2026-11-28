---
title: Web Console and Wallet
description: Use the Tyrell console in snapshot or live mode, connect QIE Wallet with Reown AppKit, sign in, and manage lane keys from the browser.
---

The web app in `apps/web` is the human's window into Tyrell. It shows what the agent remembers, where each memory came from, what was blocked and why, and lets the owner wallet act on lane keys. It never holds a key that can write memories or pay.

## Pages

| Path | What it is |
| --- | --- |
| `/` | The landing page; its dashboard shows real figures from the projection |
| [`/console`](/console) | The operator console |
| [`/start`](/start) | Get started: connect your owner wallet, then the setup commands |
| [`/playground`](/playground) | Live, in-browser demonstrations of the guarantees |
| `/docs` | This documentation |

## Data modes

The console reads one [view document](/docs/reference/view-document) from `/api/view`:

| Mode | When | Source |
| --- | --- | --- |
| Live | `TYRELL_API_URL` is set on the web server and control answers | Control's read-only API (`GET /api/view` on `127.0.0.1:7878`), proxied server-side |
| Snapshot | Otherwise | `apps/web/public/snapshot.json` |

The response header `x-tyrell-source` is `live` or `snapshot`, and the console shows a banner in snapshot mode. In live mode the console refreshes every 15 seconds.

```sh
# live, on the machine that runs control
TYRELL_API_URL=http://127.0.0.1:7878 pnpm web:dev

# write a new snapshot from a running control process
pnpm tyrell snapshot --out apps/web/public/snapshot.json
```

> [!IMPORTANT]
> The browser never talks to control directly; the Next.js server proxies it. The hosted demo never sets `TYRELL_API_URL`: control and the signer hold lane keys and stay on the operator's machine.

## Console tabs

| Tab | Shows |
| --- | --- |
| Overview | Verified memories, decisions, untrusted reads and payments blocked; the R0–R5 policy trace of the latest decision; latest decisions; payees with caps; quarantine seeds; recent memories |
| Lineage | The lineage graph of the last 60 memories: sources to memories (dashed) and parent to child (solid), coloured by lane |
| Blast radius | Pick a seed; see every memory and decision it reaches |
| Decisions | Every payment decision with its verdict, reasons, transaction link and the memories the model had read (its parents) |
| Timeline | Every memory with block, lane, kind and class (cards on phones) |
| Incidents | Sentinel incidents with score, rules, source and, when the AI judge ran, its category, confidence and reason |
| Account | Your wallet, your role on this deployment, the four lane keys, and revoke for the owner |

Click any memory to open its detail: id, class and why, lane, kind, block, verification result, seeds, signer, CID and body.

## Connecting a wallet

The wallet is how the human proves ownership and acts as owner from the browser. Connecting shares only your address. Tyrell never asks for a seed phrase.

### Reown AppKit (recommended)

When `NEXT_PUBLIC_REOWN_PROJECT_ID` is set at build time, the connection runs on [Reown AppKit](https://reown.com/appkit) with the wagmi adapter:

- Browser wallets over EIP-6963. QIE Wallet (rdns `me.qiewallet`) is listed as installed when present; when it is not, a QIE Wallet entry links to its Chrome Web Store, App Store and Google Play pages.
- Mobile wallets over WalletConnect, by QR code or deep link, and Reown's wallet directory.
- QIE Mainnet and QIE Testnet configured as networks, QIE Mainnet first. Other chains, such as a local demo chain, still work through the wallet's own provider.
- Email and social logins, swaps, on-ramp, send, receive, history and analytics are all disabled: the owner must be a wallet you hold.

To enable it, create a project at `dashboard.reown.com`, add your site's domain to its allowlist and set the variable (see `apps/web/.env.example`). The project id is public by design; the domain allowlist restricts where it works.

### Browser wallets only

Without a project id, the web app uses its own picker: wallets announced over EIP-6963, QIE Wallet first, with `window.ethereum` as a fallback. It reconnects silently to the last wallet (using `eth_accounts`, which never prompts). If no wallet is found, it suggests opening the page in the QIE Wallet app's browser on a phone, or installing the QIE Wallet extension on a computer.

### Signing in

Signing in is an EIP-4361 ("Sign-In with Ethereum") message:

```text
tyrell-mu.vercel.app wants you to sign in with your Ethereum account:
0x…

Sign in to Tyrell. This proves you hold this wallet. It is not a transaction and costs nothing.

URI: https://tyrell-mu.vercel.app
Version: 1
Chain ID: 1990
Nonce: …
Issued At: …
Expiration Time: …
```

The page asks the wallet to sign it (`personal_sign`), verifies the signature locally against your address, and keeps the session in the browser's local storage for 24 hours. Nothing is sent to a server.

### Networks

If your wallet is on another network, the wallet sheet offers **QIE Mainnet** (chain 1990) and **QIE Testnet** (chain 1983). It calls `wallet_switchEthereumChain` and, if the wallet does not know QIE yet, `wallet_addEthereumChain` with the QIE RPCs and explorer.

## The Account tab

The Account tab reads the deployment the console is showing:

1. `MemoryAnchor.registry()` gives the `LaneRegistry` address.
2. `LaneRegistry.owner()` gives the owner.
3. `LaneRegistry.activeKey(lane)` for lanes 1 to 4 gives the current keys.
4. `LaneRegistry.laneOf(yourAddress)` tells whether your address is itself a lane key.

Your role is **Owner** if your address is the registry's owner, a lane key if it is bound to a lane, and **Viewer** otherwise. Reads go through your wallet when it is on the deployment's chain, and through a public QIE RPC otherwise. For a local chain, switch your wallet to it.

### Revoking a lane key

If you are the owner and your wallet is on the deployment's chain, each lane key has a **Revoke** button. Enter a reason (it is recorded on-chain) and confirm in your wallet. The page sends `LaneRegistry.revokeLaneKey(key, reason)`, waits for the receipt and refreshes.

A revoked key stops at once: `MemoryAnchor` refuses anything it signs, and it can never be re-added. To replace it with a new key file, run:

```sh
pnpm tyrell revoke --lane <user|agent|wallet|control> --rotate
```

> [!WARNING]
> Revoking the control or signer path stops payments and anchoring until a new key is registered. Revoking is the emergency stop; rotating is the recovery.

## The get-started page

[`/start`](/start) walks a new owner through setup:

| Step | Where | Done when |
| --- | --- | --- |
| 1. Get QIE Wallet | Browser | A wallet is detected or connected |
| 2. Connect and sign in | Browser | A valid sign-in session exists |
| 3. Use the QIE network | Browser | The wallet is on chain 1990 or 1983 |
| 4. Install | Your computer | — |
| 5. Create your agent's keys and deploy | Your computer | — |
| 6. Register the keys with your wallet | Your computer | — |
| 7. Start Tyrell | Your computer | — |
| 8. Add who your agent may pay, then let it work | Your computer | — |
| 9. Watch it here | Your computer | — |

Steps 4 to 9 show the exact commands with copy buttons, and the deploy command is pre-filled with your connected address as `--owner`.

## Environment variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Build | Enables Reown AppKit; browser wallets only when unset |
| `TYRELL_API_URL` | Server | Control's read-only API for live mode |
| `TYRELL_SITE_URL` | Build | Absolute URL for social cards; defaults to the Vercel production domain, then `http://localhost:3000` |

See [Configuration](/docs/reference/configuration) for every variable.
