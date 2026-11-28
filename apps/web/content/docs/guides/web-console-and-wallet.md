---
title: Web Console and Wallet
description: Create and open your Tyrell account in the console, connect QIE Wallet with Reown AppKit, create and manage lane keys from the browser, and see the full view on a self-hosted web app.
---

The web app in `apps/web` is the human's window into Tyrell. The console is your own account: it creates one from your wallet, reads it from QIE, manages its lane keys, and, with your control process connected, shows what the agent remembers, where each memory came from and what was blocked. It never holds a key that can write memories or pay: keys it creates are encrypted in the browser and downloaded.

## Pages

| Path | What it is |
| --- | --- |
| `/` | The landing page; its product illustrations use a recorded sample run |
| [`/console`](/console) | Your Tyrell account |
| [`/start`](/start) | Get started: connect your owner wallet, then the setup commands |
| [`/playground`](/playground) | The demo: a live attack on two AI agents, 34 contract checks, and a full recorded run. The only place sample data is shown |
| `/docs` | This documentation |

## What the console shows

The console never shows sample data. It shows, in this order:

| You have | The console shows | Read from |
| --- | --- | --- |
| A web app that proxies your control process (self-hosted) | The full view: Overview, Lineage, Blast radius, Decisions, Timeline, Incidents, Keys | Control's read-only [view document](/docs/reference/view-document) |
| An account (created or opened in this browser) | Your account from QIE: Overview, Payees, Activity, Keys | The contracts, through your wallet or a public QIE RPC |
| Neither | **Your Tyrell account**: create a new account or open one you have | — |

Accounts you create or open are remembered in this browser (their contract addresses only), and the one on your wallet's network opens automatically.

### Creating an account

**Create a new account** needs a connected wallet on QIE Testnet (1983), QIE Mainnet (1990) or a local chain:

1. You choose a password. The browser makes the seven keys Tyrell's processes use (user, agent, wallet, control, submitter, signer and the data key) and encrypts each one with it, in the same keystore format `tyrell setup keys` writes.
2. Your wallet sends the transactions `tyrell deploy` would: `LaneRegistry`, `MemoryAnchor`, `TyrellLedger`, `GuardedVault` (and a test token off mainnet; on mainnet the vault uses QUSDC), then `addLaneKey` for the four lanes. That is eight or nine confirmations.
3. The account file `tyrell-account-<chain>.json` downloads: the encrypted keys, the account id and the contract addresses.

On the computer that will run Tyrell:

```sh
pnpm tyrell import ~/Downloads/tyrell-account-1983.json   # asks for the password
pnpm tyrell control start
```

`tyrell import` checks the password against every key, each key's role tag and address, refuses to overwrite existing keys, and writes `keys/`, `config.json`, `deployment-<chain>.json` and the passphrase file into `TYRELL_HOME`.

### Opening an account

**Open an account I have** takes the account file or a deployment file (`~/.tyrell/deployment-<chain>.json`, as `tyrell deploy` writes it). Only the contract addresses are read.

### Connecting your control process

Control serves a read-only view on `http://127.0.0.1:7878/api/view`. Run the web app next to it with `TYRELL_API_URL` and its console shows the full view (the server proxies it as `/api/view`):

```sh
TYRELL_API_URL=http://127.0.0.1:7878 pnpm web:dev   # then open http://localhost:3000/console
```

The hosted site does not set it. Control refuses browser requests from any page other than Tyrell's own origins (`TYRELL_WEB_ORIGINS`), so another website you visit cannot read your memories.

## Console tabs

| Tab | Shows |
| --- | --- |
| Overview (account) | Lane keys set, approved payees, memories recorded, vault balance; what is left to set up (gas for the submitter and signer, payees, funding, starting Tyrell); recent payments; the account's contracts |
| Payees | Approved payees with their caps and status |
| Activity | Memories recorded (by lane, with signer) and payments |
| Overview (full) | Verified memories, decisions, untrusted reads and payments blocked; the R0–R5 policy trace of the latest decision; latest decisions; payees; quarantine seeds; recent memories |
| Lineage | The lineage graph of the last 60 memories: sources to memories (dashed) and parent to child (solid), coloured by lane |
| Blast radius | Pick a seed; see every memory and decision it reaches |
| Decisions | Every payment decision with its verdict, reasons, transaction link and the memories the model had read |
| Timeline | Every memory with block, lane, kind and class |
| Incidents | Sentinel incidents with score, rules, source and the AI judge's verdict |
| Keys | Your wallet, your role, the four lane keys; add, replace and revoke for the owner |

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

## The Keys tab

The Keys tab reads the account's `LaneRegistry`: its owner, `activeKey(lane)` for lanes 1 to 4, and `laneOf(yourAddress)`. Your role is **Owner** if your address is the registry's owner, a lane key if it is bound to a lane, and **Viewer** otherwise.

If you are the owner and your wallet is on the account's network, each lane offers:

| Action | Sends | Notes |
| --- | --- | --- |
| **Add key** (empty lane) | `addLaneKey(lane, key)` | **Create a new key here**: the browser makes the key, encrypts it with your password and downloads `<lane>.json` for `~/.tyrell/keys/`. **Use a key I already have**: paste an address from `tyrell setup keys` |
| **Replace** | `rotateLaneKey(old, new, reason)` | The same two ways to get the new key; the reason is recorded on-chain |
| **Revoke** | `revokeLaneKey(key, reason)` | Stops the key at once; it can never be added again |

> [!WARNING]
> Revoking the control key stops payments and anchoring until a new one is added. Revoking is the emergency stop; replacing is the recovery. Use the same password as your Tyrell passphrase for keys you create here, so the processes can open them.

## The get-started page

[`/start`](/start) walks a new owner through setup:

| Step | Where | Done when |
| --- | --- | --- |
| 1. Get QIE Wallet | Browser | A wallet is detected or connected |
| 2. Connect and sign in | Browser | A valid sign-in session exists |
| 3. Use the QIE network | Browser | The wallet is on chain 1990 or 1983 |
| 4. Create your Tyrell account | Console | — |
| 5. Install Tyrell on your computer | Your computer | — |
| 6. Import your account | Your computer | — |
| 7. Start Tyrell | Your computer | — |
| 8. Approve who your agent may pay, then let it work | Your computer | — |
| 9. Watch it in the console | Console | — |

Steps 5 to 8 show the exact commands with copy buttons. Prefer the command line throughout? `tyrell setup keys`, `tyrell deploy` and `tyrell setup register` do the same as the console's account creation.

## Environment variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Build | Enables Reown AppKit; browser wallets only when unset |
| `TYRELL_API_URL` | Server | Control's read-only API for live mode |
| `TYRELL_SITE_URL` | Build | Absolute URL for social cards; defaults to the Vercel production domain, then `http://localhost:3000` |

See [Configuration](/docs/reference/configuration) for every variable.
