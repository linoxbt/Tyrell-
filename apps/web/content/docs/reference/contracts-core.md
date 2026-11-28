---
title: Core Contracts
description: Functions, events, errors and access rules of LaneRegistry, MemoryAnchor, TyrellLedger, GuardedVault and TyrellTestUSD.
---

Tyrell's core is four contracts on QIE, plus a test token for testnet and local chains. They are written in Solidity 0.8.28, compiled with the optimizer at 200 runs for the **Shanghai** EVM (QIE does not support Cancun opcodes), and use OpenZeppelin 5.4.0.

| Contract | Purpose | Admin |
| --- | --- | --- |
| [`LaneRegistry`](#laneregistry) | One active key per lane, with full history | Owner (`Ownable2Step`, never renounced) |
| [`MemoryAnchor`](#memoryanchor) | Anchors memory struct hashes and CIDs after checking the lane signature | Owner (`Ownable2Step`, never renounced) sets the submitter and the agent link |
| [`TyrellLedger`](#tyrellledger) | Payees and quarantine seeds, written only with lane-key EIP-712 signatures | None |
| [`GuardedVault`](#guardedvault) | Holds the payment token; pays registered payees within caps | `AccessControl` roles (always at least one admin) |
| [`TyrellTestUSD`](#tyrelltestusd) | 6-decimal test token, never deployed to mainnet | Owner mints |

All privileged roles go to the owner (your QIE Wallet) at construction. The many-agents contracts are documented in the [agents network](/docs/agents/overview) section.

## LaneRegistry

Binds one EVM key to each lane: 1 `user`, 2 `agent`, 3 `wallet`, 4 `control` (`ILaneRegistry.Lane`; 0 is `None`). Rules:

- one active key per lane;
- a key belongs to at most one lane, ever;
- a revoked key can never be re-added;
- `addedAt` and `revokedAt` are block numbers, kept for historical bindings.

### Functions

| Function | Access | Description |
| --- | --- | --- |
| `addLaneKey(Lane lane, address key)` | Owner | Registers `key` for `lane`. Reverts if the lane already has an active key or the key was ever used |
| `revokeLaneKey(address key, string reason)` | Owner | Revokes an active key; it can never anchor or sign ledger actions again |
| `rotateLaneKey(address oldKey, address newKey, string reason)` | Owner | Revokes `oldKey` and registers `newKey` for the same lane atomically |
| `laneOf(address key) → (Lane lane, bool active, uint64 addedAt, uint64 revokedAt)` | View | A key's binding |
| `activeKey(Lane lane) → address` | View | The lane's active key, or zero |
| `isActiveFor(address key, Lane lane) → bool` | View | True if `key` is the active key of `lane` (`lane` not `None`) |
| `owner()`, `pendingOwner()`, `transferOwnership(address)`, `acceptOwnership()` | Inherited | `Ownable2Step`: ownership is handed over in two steps |
| `renounceOwnership()` | | Always reverts `NoRenounce`: a registry without an owner could never revoke a leaked key |

### Events

| Event | When |
| --- | --- |
| `LaneKeyAdded(Lane indexed lane, address indexed key, uint64 atBlock)` | A key is registered (also emitted by a rotation) |
| `LaneKeyRevoked(Lane indexed lane, address indexed key, uint64 atBlock, string reason)` | A key is revoked (also emitted by a rotation) |

### Errors

| Error | Cause |
| --- | --- |
| `InvalidLane()` | Lane is `None` or above `Control` |
| `ZeroKey()` | Key is the zero address |
| `LaneOccupied(Lane lane)` | The lane already has an active key |
| `KeyAlreadyUsed(address key)` | The key was registered before (active or revoked) |
| `KeyNotActive(address key)` | Revoking or rotating a key that is not active |

## MemoryAnchor

Anchors the signed digest of every memory envelope, with the IPFS CID of its encrypted body. The `MemoryAnchored` log is the memory inventory. EIP-712 domain: name `Tyrell`, version `1`.

Only the submitter may anchor. The CID is not covered by the lane signature, so an open submitter would let anyone front-run a pending anchor with a junk CID and claim its id.

### The Memory struct

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `bytes16` | Memory id |
| `acct` | `bytes32` | Account id; must equal the contract's `acct` |
| `ns` | `bytes32` | keccak256 of the namespace string |
| `lane` | `uint8` | 1–4 |
| `kind` | `uint8` | 1–5 |
| `parentsHash` | `bytes32` | keccak256 of the sorted parent ids, packed |
| `srcHash` | `bytes32` | keccak256 of the RFC 8785 canonical JSON of `src` |
| `turn` | `bytes16` | Steward turn id or zero |
| `refBlock` | `uint64` | Must not exceed `block.number` |
| `bodyHash` | `bytes32` | keccak256 of the UTF-8 body |
| `bodyLen` | `uint32` | At most `MAX_BODY_LEN` (8192) |

### Functions

| Function | Access | Description |
| --- | --- | --- |
| `anchor(Memory m, bytes sig, string cid)` | Submitter | Verifies and anchors one memory |
| `anchorBatch(Memory[] ms, bytes[] sigs, string[] cids)` | Submitter | 1 to `MAX_BATCH` (20) memories, all-or-nothing |
| `anchorOf(bytes16 id) → (address signer, uint8 lane, uint64 atBlock, bytes32 structHash)` | View | The stored anchor; `atBlock` is 0 if none |
| `hashMemory(Memory m) → bytes32` | Pure | EIP-712 struct hash, as signed by the lane key |
| `digestOf(Memory m) → bytes32` | View | Full EIP-712 digest for this deployment |
| `domainSeparator() → bytes32` | View | EIP-712 domain separator |
| `setSubmitter(address submitter)` | Owner | Points anchoring at a new control gas key |
| `registry() → ILaneRegistry`, `acct() → bytes32`, `submitter() → address` | View | Configuration |
| `MEMORY_TYPEHASH`, `MAX_BATCH`, `MAX_BODY_LEN` | Constant | Typehash, 20, 8192 |
| `linkAgent(IAgentRegistry registry, uint256 agentId)` | Owner | Agents network: gate agent-lane memories on this agent (zero registry unlinks); emits `AgentLinked` |
| `agentRegistry()`, `agentId()`, `PERM_MEMORY` | View, constant | The agent link; `PERM_MEMORY` is 2 |
| `owner()`, `pendingOwner()`, `transferOwnership`, `acceptOwnership`, `eip712Domain()` | Inherited | `Ownable2Step`, `EIP712` |
| `renounceOwnership()` | | Always reverts `NoRenounce` |

### Checks, in order

1. `m.acct == acct`, else `BadAccount`.
2. Non-zero id; lane 1–4; kind 1–5; `bodyLen <= 8192`; `refBlock <= block.number`; non-empty CID. Else `BadMemory`.
3. The id is not anchored yet, else `AlreadyAnchored`.
4. The signature recovers (else `UnknownSigner`), the signer is bound in `LaneRegistry` (else `UnknownSigner`), still active (else `KeyRevoked`) and bound to `m.lane` (else `LaneMismatch`).
5. Only for agent-lane memories, and only once `linkAgent` was called: the linked agent is active in `AgentRegistry` (else `AgentBlocked(code)`, for example `AGENT_BANNED` or `HUMAN_UNBOUND`), its registered key is the signer (else `AgentKeyMismatch`) and it holds the memory permission (else `NoMemoryPermission`). See the [agents network](/docs/agents/agents-and-limits#spenders).

### Events

| Event | Fields |
| --- | --- |
| `MemoryAnchored` | `bytes16 indexed id, uint8 indexed lane, address indexed signer, bytes32 ns, bytes32 structHash, bytes32 parentsHash, bytes32 bodyHash, string cid, uint64 refBlock` |
| `SubmitterChanged` | `address indexed previous, address indexed current` |

### Errors

| Error | Cause |
| --- | --- |
| `UnknownSigner()` | Signature does not recover, or the signer is not a lane key |
| `LaneMismatch()` | The signer is bound to a different lane |
| `KeyRevoked()` | The signer's key was revoked |
| `AlreadyAnchored()` | The id is already anchored |
| `BadAccount()` | Wrong account id |
| `NotSubmitter()` | Caller is not the submitter |
| `BadMemory()` | A field is out of range, or the CID is empty |
| `BatchSize()` | Batch empty, over 20, or array lengths differ |

## TyrellLedger

All control state that decides who can be paid and what is excluded: payees, quarantine seeds and releases. Every write carries an EIP-712 signature from a lane key, checked against `LaneRegistry`. Anyone may submit a signed action; it can only do what its signer signed. EIP-712 domain: name `TyrellLedger`, version `1`. **The ledger has no owner and no admin path.**

| Action | Signer lane |
| --- | --- |
| `addPayee`, `removePayee`, `reinstatePayee`, `releaseQuarantine` | `user` |
| `seedQuarantine`, `suspendPayee` | `control` |

Control can suspend a payee but never add or reinstate one. Every action burns a per-signer nonce, which must be strictly greater than the signer's last nonce, and has a deadline.

### Structs

`Payee`: `address addr`, `address token`, `uint128 capPerTx`, `uint128 capPerDay`, `string label`, `bool active`, `bool suspended`.

`Seed`: `uint8 seedType` (1 memory, 2 source, 3 signer-window, 4 turn), `bytes32 value`, `uint64 fromBlock`, `uint64 toBlock`, `string reasonCid`, `address signer`, `bool released`.

### Functions

| Function | Signed by | Description |
| --- | --- | --- |
| `addPayee(Payee p, bytes32 payeeId, uint256 nonce, uint64 deadline, bytes userSig)` | user | Creates a payee. Requires non-zero id, address and token; `capPerTx > 0`; `capPerDay >= capPerTx`; label 1–64 bytes; id unused |
| `removePayee(bytes32 payeeId, uint256 nonce, uint64 deadline, bytes userSig)` | user | Sets `active = false` |
| `reinstatePayee(bytes32 payeeId, uint256 nonce, uint64 deadline, bytes userSig)` | user | Sets `active = true`, `suspended = false` |
| `releaseQuarantine(uint256 seedId, string reasonCid, uint256 nonce, uint64 deadline, bytes userSig)` | user | Releases an active seed; reason CID required |
| `seedQuarantine(uint8 seedType, bytes32 seedValue, uint64 fromBlock, uint64 toBlock, string reasonCid, uint256 nonce, uint64 deadline, bytes controlSig) → uint256 seedId` | control | Creates a seed. Type 1–4, non-zero value, reason CID required; block range only for signer-window (`fromBlock <= toBlock`), zero otherwise |
| `suspendPayee(bytes32 payeeId, uint256 seedId, uint256 nonce, uint64 deadline, bytes controlSig)` | control | Suspends a payee, citing an active seed |
| `payee(bytes32 payeeId) → Payee` | View | A payee (zero address if none) |
| `seed(uint256 seedId) → Seed` | View | A seed |
| `lastNonce(address signer) → uint256` | View | The signer's last used nonce |
| `isPayable(bytes32 payeeId, address token, uint256 amount) → (bool ok, address to, bytes32 code)` | View | Static payment rules; the vault adds the daily caps |
| `activeSeeds() → uint256[]` | View | Ids of unreleased seeds |
| `seedCount() → uint256` | View | Seeds created so far |
| `domainSeparator() → bytes32` | View | EIP-712 domain separator |
| `hashAddPayee(Payee p, bytes32 payeeId, uint256 nonce, uint64 deadline) → bytes32` | Pure | Struct hash for `AddPayee`, for checking off-chain encodings |
| `registry() → ILaneRegistry` | View | The lane registry |

Public constants: the six typehashes (`ADD_PAYEE_TYPEHASH`, `REMOVE_PAYEE_TYPEHASH`, `REINSTATE_PAYEE_TYPEHASH`, `RELEASE_QUARANTINE_TYPEHASH`, `SEED_QUARANTINE_TYPEHASH`, `SUSPEND_PAYEE_TYPEHASH`), the seed types `SEED_MEMORY` (1), `SEED_SOURCE` (2), `SEED_SIGNER_WINDOW` (3), `SEED_TURN` (4), and `MAX_LABEL_BYTES` (64). The typed-data definitions are in [Envelope format](/docs/reference/envelope-format#ledger-actions).

### isPayable codes

| `code` | When |
| --- | --- |
| `UNKNOWN_PAYEE` | No payee with that id |
| `PAYEE_REMOVED` | The payee is not active |
| `PAYEE_SUSPENDED` | The payee is suspended |
| `ASSET_MISMATCH` | `token` is not the payee's token |
| `ZERO_AMOUNT` | `amount == 0` |
| `OVER_CAP` | `amount > capPerTx` |

### Events

| Event | Fields |
| --- | --- |
| `PayeeAdded` | `bytes32 indexed payeeId, address addr, address token, uint128 capPerTx, uint128 capPerDay, string label, address signer` |
| `PayeeRemoved` | `bytes32 indexed payeeId, address signer` |
| `PayeeSuspended` | `bytes32 indexed payeeId, uint256 seedId` |
| `PayeeReinstated` | `bytes32 indexed payeeId, address signer` |
| `QuarantineSeeded` | `uint256 indexed seedId, uint8 seedType, bytes32 seedValue, uint64 fromBlock, uint64 toBlock, string reasonCid, address signer` |
| `QuarantineReleased` | `uint256 indexed seedId, string reasonCid, address signer` |

### Errors

| Error | Cause |
| --- | --- |
| `WrongLane(address signer)` | The signature does not recover to the active key of the required lane |
| `Expired()` | `block.timestamp > deadline` |
| `StaleNonce(uint256 nonce, uint256 lastUsed)` | `nonce <= lastUsed` for that signer |
| `BadPayee()` | A payee field is invalid |
| `PayeeExists(bytes32 payeeId)` | The id is already taken |
| `UnknownPayee(bytes32 payeeId)` | No payee with that id |
| `PayeeNotActive(bytes32 payeeId)` | Removing a payee that is not active |
| `BadSeed()` | A seed field is invalid, or an empty release reason |
| `UnknownSeed(uint256 seedId)` | No such seed, or (for `suspendPayee`) the seed is not active |
| `SeedReleased(uint256 seedId)` | The seed is already released |

## GuardedVault

Holds the agent's payment token. `pay` is the only way money leaves to anyone but the owner, and it re-checks on-chain what the policy engine checked off-chain. A leaked signer key can lose at most one day's capped spend, and only to payees the human registered. "Today" is `block.timestamp / 1 days` (UTC), the same boundary the policy engine uses. A token with no global daily cap cannot be paid at all.

### Roles

| Role | Granted at construction to | Can |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | The owner | `withdraw`, `setGlobalDailyCap`, `setAgentRegistry`, `unpause`, manage roles. The last admin can't renounce or be revoked (`LastAdmin`) |
| `SIGNER_ROLE` (`keccak256("SIGNER_ROLE")`) | The vault signer key | `pay` |
| `PAUSER_ROLE` (`keccak256("PAUSER_ROLE")`) | The owner, and optionally one extra pauser (the 4th constructor argument; `Deploy.s.sol` passes zero) | `pause` |

Besides `PAUSER_ROLE` holders, **whichever key is the active control-lane key in the `LaneRegistry` right now** may pause (`isControlKey`). The vault reads it live through the ledger, so rotating or revoking the control key moves this right with it and needs no vault transaction.

### Functions

| Function | Access | Description |
| --- | --- | --- |
| `pay(bytes32 payeeId, address token, uint256 amount, bytes16 decisionId)` | `SIGNER_ROLE`, not paused | Pays a registered payee for an ALLOW decision. Reverts `UseAgentPath` once an agent registry is linked: payments then go through [`payForAgent`](/docs/reference/contracts-agents#guardedvault-additions) |
| `withdraw(address token, address to, uint256 amount)` | Admin | Takes funds out of the vault |
| `setGlobalDailyCap(address token, uint256 cap)` | Admin | The most the vault may pay in `token` per UTC day, across all payees |
| `pause()` | Pauser or the active control-lane key | Stops all payments |
| `isControlKey(address key) → bool` | View | Whether `key` is the active control-lane key right now |
| `adminCount() → uint256` | View | Accounts holding `DEFAULT_ADMIN_ROLE` (never zero) |
| `unpause()` | Admin | Resumes payments |
| `spentToday(bytes32 payeeId) → uint256` | View | Paid to this payee today |
| `spentTodayGlobal(address token) → uint256` | View | Paid in this token today, all payees |
| `globalDailyCap(address token) → uint256` | View | The token's daily cap |
| `decisionUsed(bytes16 decisionId) → bool` | View | Whether a decision id has been paid |
| `ledger() → ITyrellLedger` | View | The ledger |
| `paused()`, `hasRole`, `getRoleAdmin`, `grantRole`, `revokeRole`, `renounceRole`, `supportsInterface` | Inherited | `Pausable`, `AccessControl` |

`pay` is also `nonReentrant`.

### pay checks, in order

1. `decisionId` is non-zero and unused, else `BadDecision`.
2. `ledger.isPayable(payeeId, token, amount)` is ok, else `NotPayable(code)` with the ledger's code.
3. The payee's spend today plus `amount` is within `capPerDay`, else `NotPayable("OVER_DAILY_CAP")`.
4. The vault's spend today in `token` plus `amount` is within `globalDailyCap[token]`, else `NotPayable("OVER_GLOBAL_DAILY_CAP")`.
5. Marks the decision used, records the spend, transfers the tokens to the payee's address, emits `Paid`.

### Events

| Event | Fields |
| --- | --- |
| `Paid` | `bytes32 indexed payeeId, address indexed to, address token, uint256 amount, bytes16 decisionId` |
| `Withdrawn` | `address indexed to, address token, uint256 amount` |
| `GlobalDailyCapSet` | `address indexed token, uint256 cap` |

Plus the inherited `Paused`, `Unpaused`, `RoleGranted`, `RoleRevoked` and `RoleAdminChanged`.

### Errors

| Error | Cause |
| --- | --- |
| `NotPayable(bytes32 code)` | A ledger code from `isPayable`, `OVER_DAILY_CAP` or `OVER_GLOBAL_DAILY_CAP` |
| `BadDecision()` | Zero or already used decision id |
| `ZeroAddress()` | Zero admin or ledger at construction, or zero `to` in `withdraw` |
| `UseAgentPath()` | `pay` on a vault linked to an agent registry |
| `LastAdmin()` | Revoking or renouncing the last `DEFAULT_ADMIN_ROLE` holder |
| `NoAgentRegistry()`, `NotOurAgent(uint256)` | See [`payForAgent`](/docs/reference/contracts-agents#guardedvault-additions) |

Plus the inherited `EnforcedPause` (paying while paused) and `AccessControlUnauthorizedAccount`.

## TyrellTestUSD

A testnet stand-in for QUSDC: an ERC-20 named `Tyrell Test USD (testnet only)`, symbol `tUSD`, 6 decimals. Worthless by design and never deployed to mainnet. `tyrell deploy` deploys it automatically when no `--token` is given on a non-mainnet chain.

| Function | Access | Description |
| --- | --- | --- |
| `mint(address to, uint256 amount)` | Owner | Mints test tokens (`tyrell setup register --mint` uses this) |
| `decimals() → uint8` | Pure | 6 |
| ERC-20 functions and `Ownable` | Inherited | `transfer`, `approve`, `balanceOf`, … |

## Gas

From `forge test --gas-report` (optimizer 200 runs, Shanghai); the full table is in `contracts/GAS.md`:

| Contract | Deployment gas | Notable call | Median gas |
| --- | ---: | --- | ---: |
| `LaneRegistry` | 728,221 | `addLaneKey` | 71,858 |
| `MemoryAnchor` | 1,638,117 | `anchor` | 44,494 (a successful anchor about 95,000; up to about 145,000 on a linked agent deployment) |
| `TyrellLedger` | 2,159,847 | `addPayee` | 178,807 |
| `GuardedVault` | 1,400,030 | `pay` | 34,626 |
| `TyrellTestUSD` | 600,248 | — | — |

All five together: 6,526,463 gas, about 0.0073 QIEV3 at the probe's mainnet gas price of 1.125 gwei.

## Tests

The contracts have 147 Foundry tests, core and agents network together: unit tests, fuzz tests at 1,000 runs, invariants (for example, outflows only ever go to registered payees) and vectors signed by the TypeScript code, so on-chain and off-chain encodings cannot drift apart. Run them with `pnpm contracts:test`.
