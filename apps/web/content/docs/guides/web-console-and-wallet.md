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
| Live | `TYRELL_API_URL` is set on the web server and control answers | Control's read-only API (`GET /api/view` on `127.0.0.1:7878`), proxied server-side with `TYRELL_API_TOKEN` as the bearer token |
| Recorded | Otherwise | `apps/web/public/snapshot.json`, a recorded run |

The response header `x-tyrell-source` is `live` or `snapshot`. On a recording the console says **Recorded demo · read-only** above the tabs, reads the document once and does not poll. In live mode it refreshes every 15 seconds while the tab is visible, pauses when you switch away, and refreshes again when you come back.

```sh
# live, on the machine that runs control (control writes its token to TYRELL_HOME/api-token)
TYRELL_API_URL=http://127.0.0.1:7878 TYRELL_API_TOKEN=$(cat ~/.tyrell/api-token) pnpm web:dev

# write a new recording from a running control process (memory contents left out)
pnpm tyrell snapshot --out apps/web/public/snapshot.json
# keep the memory bodies, for demo data you mean to publish
pnpm tyrell snapshot --out apps/web/public/snapshot.json --include-bodies
```

> [!IMPORTANT]
> The browser never talks to control directly; the Next.js server proxies it. Control's view API answers only with its bearer token and only to a loopback `Host` (`127.0.0.1`, `localhost` or `[::1]`), so a hosted console can reach it only through a tunnel that rewrites the `Host` header to `127.0.0.1`. The view contains decrypted memory bodies: expose it only for demo data. The hosted demo serves a recording.

## Console tabs

| Tab | Shows |
| --- | --- |
| Overview | Verified memories, decisions, untrusted reads and payments blocked; the R0–R5 policy trace of the latest decision; latest decisions; payees with caps; quarantine seeds; recent memories |
| Lineage | The lineage graph of the last 60 memories: sources to memories (dashed) and parent to child (solid), coloured by lane |
| Blast radius | Pick a seed; see every memory and decision it reaches |
| Decisions | Every payment decision with its verdict, reasons, transaction link and the memories the model had read (its parents) |
| Timeline | Every memory with block, lane, kind and class (cards on phones) |
| Incidents | Sentinel incidents with score, rules, source and, when the AI judge ran, its category, confidence and reason. Each opens its own page |
| Account | Your wallet, your role on this deployment, the four lane keys, and add, replace and revoke for the owner |

Click any memory to open its detail (it scrolls into view): id, class and why, lane, kind, block, verification result, seeds, signer, CID and body. Memories, timeline rows and incidents can be opened from the keyboard too (Tab, then Enter or Space).

### Links into the console

| Link | Opens |
| --- | --- |
| `/console?incident=<memory id>` | That incident's own page |
| `/console?tab=blast&seed=<seedId>` | The blast radius of that seed, as printed by `tyrell blast <seedId>` |
| `/console?tab=<tab>` | A tab: `overview`, `graph`, `blast`, `decisions`, `timeline`, `incidents` or `account` |

### Incident pages

Clicking an incident (**See details →**) opens its own page at `/console?incident=<memory id>`, so the browser's back button returns to the list. It shows the score and level; the source with an explorer link; what arrived (the memory body, when the recording keeps it); why the alarm went off (each rule that matched and its points); the AI judge's verdict, if it ran; the quarantine seeds that cover it, with a link to their blast radius, or the `tyrell quarantine --source` command to seed one; the payments it touched; and the memory record. **← All incidents** always returns to the list, even when the page was opened from a link.

## Connecting a wallet

The wallet is how the human proves ownership and acts as owner from the browser. Connecting shares only your address. Tyrell never asks for a seed phrase.

### Reown AppKit (recommended)

When `NEXT_PUBLIC_REOWN_PROJECT_ID` is set at build time, the connection runs on [Reown AppKit](https://reown.com/appkit) with the wagmi adapter:

- Browser wallets over EIP-6963. QIE Wallet (rdns `me.qiewallet`) is listed as installed when present; when it is not, a QIE Wallet entry links to its Chrome Web Store, App Store and Google Play pages.
- Mobile wallets over WalletConnect, by QR code or deep link, and Reown's wallet directory.
- QIE Mainnet and QIE Testnet configured as networks, QIE Mainnet first. Other chains, such as a local demo chain, still work through the wallet's own provider.
- Email and social logins, swaps, on-ramp, send, receive, history and analytics are all disabled: the owner must be a wallet you hold.

To enable it, create a project at `dashboard.reown.com`, add your site's domain to its allowlist and set the variable (see `apps/web/.env.example`). The project id is public by design; the domain allowlist restricts where it works.

The wallet code loads only where it is needed: at once on the console and the get-started page, and elsewhere on the first click of **Connect wallet** (or in the background for a returning visitor), so the landing page and the docs stay light.

### Browser wallets only

Without a project id (or with `NEXT_PUBLIC_WALLET_MODE=injected`), the web app uses its own picker: wallets announced over EIP-6963, QIE Wallet first, with `window.ethereum` as a fallback. It reconnects silently to the last wallet (using `eth_accounts`, which never prompts). If no wallet is found, it suggests opening the page in the QIE Wallet app's browser on a phone, or installing the QIE Wallet extension on a computer.

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

Reads go through your wallet when it is on the deployment's chain, and through a public QIE RPC otherwise. Your role is **Owner** if your address is the registry's owner, a lane key if it is bound to a lane, and **Viewer** otherwise; until the registry has been read it shows as unknown.

If the console is showing a run recorded on a local test chain (chain 31337, as the hosted demo does), there is no public RPC to read it from. The tab says so in plain words: the recording only exists on the computer that made it, so there are no keys to manage here. To manage your own keys, run the console next to your Tyrell deployment on QIE with `TYRELL_API_URL` (see [Data modes](#data-modes)). The page never offers to add or switch your wallet to a local chain.

### Adding, replacing and revoking lane keys

If you are the owner and your wallet is on the deployment's chain, each lane shows **Add key** when it has no active key, and **Replace** and **Revoke** when it has one.

- **Add key** sends `LaneRegistry.addLaneKey(lane, key)`.
- **Replace** sends `LaneRegistry.rotateLaneKey(oldKey, newKey, reason)`: the old key is revoked and the new one bound in one transaction.
- **Revoke** sends `LaneRegistry.revokeLaneKey(key, reason)`. A revoked key stops at once (`MemoryAnchor` refuses anything it signs) and can never be re-added.

For a new key you choose where it comes from:

| Option | What happens |
| --- | --- |
| **Create a new key here** | Enter a password twice and press **Create and download**. The key is generated and encrypted in the page and saved as `<role>.json`, in the exact keystore format the processes read (with the role MAC). It is made once per attempt: retrying reuses it, and **Download again** saves another copy. The transaction button stays disabled until you tick **I saved `<role>.json`**. Put the file in `TYRELL_HOME/keys/` and the password in that role's passphrase file (`TYRELL_HOME/pass.d/<role>`) |
| **Use a key I already have** | Paste the address of a key you made with `pnpm tyrell setup keys` (from `keys/addresses.json`) |

Replace and revoke ask for a reason, which is recorded on-chain. The page waits for the receipt: if the transaction reverts it says **The transaction failed on-chain, so nothing changed**, and you can try again.

> [!NOTE]
> Creating a key in the browser is a deliberate exception to NFR-01 ("no private key in the browser"): the secret exists briefly in the tab, and only the encrypted file leaves it. If that matters to you, use **Use a key I already have**. See [Known limitations](/docs/security/limitations#lane-keys-can-be-created-in-the-browser).

From the terminal, `tyrell revoke --lane <user|agent|wallet|control> [--rotate]` does the same from a local page.

> [!WARNING]
> Revoking the control or signer path stops payments and anchoring until a new key is registered. Revoking is the emergency stop; replacing is the recovery.

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
| `NEXT_PUBLIC_WALLET_MODE` | Build | `reown` or `injected` to force a wallet stack |
| `TYRELL_API_URL` | Server | Control's read-only API for live mode |
| `TYRELL_API_TOKEN` | Server | Control's view API token, sent as `Authorization: Bearer` |
| `FORTYTWO_API_KEY` | Server | The playground's live AI demo |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Server | Optional shared rate limit for the AI demo |
| `TYRELL_SITE_URL` | Build | Absolute URL for social cards; defaults to the Vercel production domain, then `https://tyrell-mu.vercel.app` |

The site sends `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` on every page, so no other site can frame it.

See [Configuration](/docs/reference/configuration) for every variable.
