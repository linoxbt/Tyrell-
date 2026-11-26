// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ILaneRegistry} from "./interfaces/ILaneRegistry.sol";
import {ITyrellLedger} from "./interfaces/ITyrellLedger.sol";

/// @title TyrellLedger
/// @notice All control state that decides who can be paid and what is excluded (spec section 8.3):
///         payees, quarantine seeds and releases. Invariant I-11.
/// @dev Every write carries an EIP-712 signature from a lane key, checked against LaneRegistry:
///      user lane for payee add/remove/reinstate and quarantine release; control lane for quarantine
///      seeds and payee suspension. Control can suspend a payee but never add or reinstate one.
///      Anyone may submit; a submitted signature can only do what its signer signed.
///      The ledger has no owner and no admin path.
contract TyrellLedger is ITyrellLedger, EIP712 {
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant ADD_PAYEE_TYPEHASH = keccak256(
        "AddPayee(bytes32 payeeId,address addr,address token,uint128 capPerTx,uint128 capPerDay,string label,uint256 nonce,uint64 deadline)"
    );
    bytes32 public constant REMOVE_PAYEE_TYPEHASH =
        keccak256("RemovePayee(bytes32 payeeId,uint256 nonce,uint64 deadline)");
    bytes32 public constant REINSTATE_PAYEE_TYPEHASH =
        keccak256("ReinstatePayee(bytes32 payeeId,uint256 nonce,uint64 deadline)");
    bytes32 public constant RELEASE_QUARANTINE_TYPEHASH =
        keccak256("ReleaseQuarantine(uint256 seedId,string reasonCid,uint256 nonce,uint64 deadline)");
    bytes32 public constant SEED_QUARANTINE_TYPEHASH = keccak256(
        "SeedQuarantine(uint8 seedType,bytes32 seedValue,uint64 fromBlock,uint64 toBlock,string reasonCid,uint256 nonce,uint64 deadline)"
    );
    bytes32 public constant SUSPEND_PAYEE_TYPEHASH =
        keccak256("SuspendPayee(bytes32 payeeId,uint256 seedId,uint256 nonce,uint64 deadline)");

    uint8 public constant SEED_MEMORY = 1;
    uint8 public constant SEED_SOURCE = 2;
    uint8 public constant SEED_SIGNER_WINDOW = 3;
    uint8 public constant SEED_TURN = 4;
    uint256 public constant MAX_LABEL_BYTES = 64;

    ILaneRegistry public immutable registry;

    mapping(bytes32 payeeId => Payee) private _payees;
    mapping(uint256 seedId => Seed) private _seeds;
    mapping(address signer => uint256) private _lastNonce;
    EnumerableSet.UintSet private _activeSeeds;
    uint256 public seedCount;

    constructor(ILaneRegistry registry_) EIP712("TyrellLedger", "1") {
        registry = registry_;
    }

    // ------------------------------------------------------------------ user lane

    /// @inheritdoc ITyrellLedger
    function addPayee(Payee calldata p, bytes32 payeeId, uint256 nonce, uint64 deadline, bytes calldata userSig)
        external
    {
        address signer =
            _consume(_hashAddPayee(p, payeeId, nonce, deadline), userSig, ILaneRegistry.Lane.User, nonce, deadline);
        if (
            payeeId == bytes32(0) || p.addr == address(0) || p.token == address(0) || p.capPerTx == 0
                || p.capPerDay < p.capPerTx || bytes(p.label).length == 0 || bytes(p.label).length > MAX_LABEL_BYTES
        ) revert BadPayee();
        if (_payees[payeeId].addr != address(0)) revert PayeeExists(payeeId);
        _payees[payeeId] = Payee({
            addr: p.addr,
            token: p.token,
            capPerTx: p.capPerTx,
            capPerDay: p.capPerDay,
            label: p.label,
            active: true,
            suspended: false
        });
        emit PayeeAdded(payeeId, p.addr, p.token, p.capPerTx, p.capPerDay, p.label, signer);
    }

    /// @inheritdoc ITyrellLedger
    function removePayee(bytes32 payeeId, uint256 nonce, uint64 deadline, bytes calldata userSig) external {
        bytes32 h = keccak256(abi.encode(REMOVE_PAYEE_TYPEHASH, payeeId, nonce, deadline));
        address signer = _consume(h, userSig, ILaneRegistry.Lane.User, nonce, deadline);
        Payee storage p = _existing(payeeId);
        if (!p.active) revert PayeeNotActive(payeeId);
        p.active = false;
        emit PayeeRemoved(payeeId, signer);
    }

    /// @inheritdoc ITyrellLedger
    function reinstatePayee(bytes32 payeeId, uint256 nonce, uint64 deadline, bytes calldata userSig) external {
        bytes32 h = keccak256(abi.encode(REINSTATE_PAYEE_TYPEHASH, payeeId, nonce, deadline));
        address signer = _consume(h, userSig, ILaneRegistry.Lane.User, nonce, deadline);
        Payee storage p = _existing(payeeId);
        p.active = true;
        p.suspended = false;
        emit PayeeReinstated(payeeId, signer);
    }

    /// @inheritdoc ITyrellLedger
    function releaseQuarantine(
        uint256 seedId,
        string calldata reasonCid,
        uint256 nonce,
        uint64 deadline,
        bytes calldata userSig
    ) external {
        bytes32 h = keccak256(
            abi.encode(RELEASE_QUARANTINE_TYPEHASH, seedId, keccak256(bytes(reasonCid)), nonce, deadline)
        );
        address signer = _consume(h, userSig, ILaneRegistry.Lane.User, nonce, deadline);
        Seed storage s = _seeds[seedId];
        if (s.seedType == 0) revert UnknownSeed(seedId);
        if (s.released) revert SeedReleased(seedId);
        if (bytes(reasonCid).length == 0) revert BadSeed();
        s.released = true;
        _activeSeeds.remove(seedId);
        emit QuarantineReleased(seedId, reasonCid, signer);
    }

    // ------------------------------------------------------------------ control lane

    /// @inheritdoc ITyrellLedger
    function seedQuarantine(
        uint8 seedType,
        bytes32 seedValue,
        uint64 fromBlock,
        uint64 toBlock,
        string calldata reasonCid,
        uint256 nonce,
        uint64 deadline,
        bytes calldata controlSig
    ) external returns (uint256 seedId) {
        bytes32 h = keccak256(
            abi.encode(
                SEED_QUARANTINE_TYPEHASH,
                seedType,
                seedValue,
                fromBlock,
                toBlock,
                keccak256(bytes(reasonCid)),
                nonce,
                deadline
            )
        );
        address signer = _consume(h, controlSig, ILaneRegistry.Lane.Control, nonce, deadline);
        if (seedType == 0 || seedType > SEED_TURN || seedValue == bytes32(0) || bytes(reasonCid).length == 0) {
            revert BadSeed();
        }
        if (seedType == SEED_SIGNER_WINDOW) {
            if (fromBlock > toBlock) revert BadSeed();
        } else if (fromBlock != 0 || toBlock != 0) {
            revert BadSeed();
        }
        seedId = ++seedCount;
        _seeds[seedId] = Seed({
            seedType: seedType,
            value: seedValue,
            fromBlock: fromBlock,
            toBlock: toBlock,
            reasonCid: reasonCid,
            signer: signer,
            released: false
        });
        _activeSeeds.add(seedId);
        emit QuarantineSeeded(seedId, seedType, seedValue, fromBlock, toBlock, reasonCid, signer);
    }

    /// @inheritdoc ITyrellLedger
    function suspendPayee(bytes32 payeeId, uint256 seedId, uint256 nonce, uint64 deadline, bytes calldata controlSig)
        external
    {
        bytes32 h = keccak256(abi.encode(SUSPEND_PAYEE_TYPEHASH, payeeId, seedId, nonce, deadline));
        _consume(h, controlSig, ILaneRegistry.Lane.Control, nonce, deadline);
        Payee storage p = _existing(payeeId);
        if (!_activeSeeds.contains(seedId)) revert UnknownSeed(seedId);
        p.suspended = true;
        emit PayeeSuspended(payeeId, seedId);
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc ITyrellLedger
    function payee(bytes32 payeeId) external view returns (Payee memory) {
        return _payees[payeeId];
    }

    /// @inheritdoc ITyrellLedger
    function seed(uint256 seedId) external view returns (Seed memory) {
        return _seeds[seedId];
    }

    /// @inheritdoc ITyrellLedger
    function lastNonce(address signer) external view returns (uint256) {
        return _lastNonce[signer];
    }

    /// @inheritdoc ITyrellLedger
    function isPayable(bytes32 payeeId, address token, uint256 amount)
        external
        view
        returns (bool ok, address to, bytes32 code)
    {
        Payee storage p = _payees[payeeId];
        if (p.addr == address(0)) return (false, address(0), "UNKNOWN_PAYEE");
        if (!p.active) return (false, p.addr, "PAYEE_REMOVED");
        if (p.suspended) return (false, p.addr, "PAYEE_SUSPENDED");
        if (token != p.token) return (false, p.addr, "ASSET_MISMATCH");
        if (amount == 0) return (false, p.addr, "ZERO_AMOUNT");
        if (amount > p.capPerTx) return (false, p.addr, "OVER_CAP");
        return (true, p.addr, bytes32(0));
    }

    /// @inheritdoc ITyrellLedger
    function activeSeeds() external view returns (uint256[] memory) {
        return _activeSeeds.values();
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Struct hash for AddPayee, exposed so off-chain signers can check their encoding.
    function hashAddPayee(Payee calldata p, bytes32 payeeId, uint256 nonce, uint64 deadline)
        external
        pure
        returns (bytes32)
    {
        return _hashAddPayee(p, payeeId, nonce, deadline);
    }

    // ------------------------------------------------------------------ internals

    function _hashAddPayee(Payee calldata p, bytes32 payeeId, uint256 nonce, uint64 deadline)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                ADD_PAYEE_TYPEHASH,
                payeeId,
                p.addr,
                p.token,
                p.capPerTx,
                p.capPerDay,
                keccak256(bytes(p.label)),
                nonce,
                deadline
            )
        );
    }

    /// @dev Verifies signature, lane, deadline and nonce, then burns the nonce. Returns the signer.
    function _consume(bytes32 structHash, bytes calldata sig, ILaneRegistry.Lane lane, uint256 nonce, uint64 deadline)
        private
        returns (address signer)
    {
        if (block.timestamp > deadline) revert Expired();
        ECDSA.RecoverError err;
        (signer, err,) = ECDSA.tryRecover(_hashTypedDataV4(structHash), sig);
        if (err != ECDSA.RecoverError.NoError || !registry.isActiveFor(signer, lane)) revert WrongLane(signer);
        uint256 last = _lastNonce[signer];
        if (nonce <= last) revert StaleNonce(nonce, last);
        _lastNonce[signer] = nonce;
    }

    function _existing(bytes32 payeeId) private view returns (Payee storage p) {
        p = _payees[payeeId];
        if (p.addr == address(0)) revert UnknownPayee(payeeId);
    }
}
