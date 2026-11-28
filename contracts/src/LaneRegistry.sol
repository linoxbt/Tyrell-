// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ILaneRegistry} from "./interfaces/ILaneRegistry.sol";

/// @title LaneRegistry
/// @notice Binds one EVM key to each Tyrell lane. Only the owner (the human's QIE Wallet) can add,
///         revoke or rotate keys, so every binding is owner-attested on-chain (spec section 8.1).
/// @dev Rules: one active key per lane; a key belongs to at most one lane, ever; a revoked key can
///      never be re-added. `addedAt` / `revokedAt` are block numbers kept for historical bindings.
///      Ownership can be handed over (two-step) but never renounced: a registry without an owner could
///      never revoke a leaked key.
contract LaneRegistry is ILaneRegistry, Ownable2Step {
    error NoRenounce();

    mapping(address key => KeyInfo) private _keys;
    mapping(Lane lane => address key) private _active;

    constructor(address owner_) Ownable(owner_) {}

    /// @inheritdoc ILaneRegistry
    function addLaneKey(Lane lane, address key) external onlyOwner {
        _add(lane, key);
    }

    /// @inheritdoc ILaneRegistry
    function revokeLaneKey(address key, string calldata reason) external onlyOwner {
        _revoke(key, reason);
    }

    /// @inheritdoc ILaneRegistry
    function rotateLaneKey(address oldKey, address newKey, string calldata reason) external onlyOwner {
        Lane lane = _keys[oldKey].lane;
        _revoke(oldKey, reason);
        _add(lane, newKey);
    }

    /// @notice Disabled: hand ownership over with transferOwnership instead.
    function renounceOwnership() public pure override {
        revert NoRenounce();
    }

    /// @inheritdoc ILaneRegistry
    function laneOf(address key) external view returns (Lane lane, bool active, uint64 addedAt, uint64 revokedAt) {
        KeyInfo memory k = _keys[key];
        return (k.lane, k.active, k.addedAt, k.revokedAt);
    }

    /// @inheritdoc ILaneRegistry
    function activeKey(Lane lane) external view returns (address) {
        return _active[lane];
    }

    /// @inheritdoc ILaneRegistry
    function isActiveFor(address key, Lane lane) external view returns (bool) {
        KeyInfo memory k = _keys[key];
        return k.active && k.lane == lane && lane != Lane.None;
    }

    function _add(Lane lane, address key) private {
        if (lane == Lane.None || uint8(lane) > uint8(Lane.Control)) revert InvalidLane();
        if (key == address(0)) revert ZeroKey();
        if (_active[lane] != address(0)) revert LaneOccupied(lane);
        if (_keys[key].addedAt != 0) revert KeyAlreadyUsed(key);
        uint64 at = uint64(block.number);
        _keys[key] = KeyInfo({lane: lane, active: true, addedAt: at, revokedAt: 0});
        _active[lane] = key;
        emit LaneKeyAdded(lane, key, at);
    }

    function _revoke(address key, string calldata reason) private {
        KeyInfo storage k = _keys[key];
        if (!k.active) revert KeyNotActive(key);
        uint64 at = uint64(block.number);
        k.active = false;
        k.revokedAt = at;
        delete _active[k.lane];
        emit LaneKeyRevoked(k.lane, key, at, reason);
    }
}
