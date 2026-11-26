// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

interface ILaneRegistry {
    /// @dev Lane IDs match the envelope's `lane` field: 1 user, 2 agent, 3 wallet, 4 control.
    enum Lane {
        None,
        User,
        Agent,
        Wallet,
        Control
    }

    struct KeyInfo {
        Lane lane;
        bool active;
        uint64 addedAt; // block number
        uint64 revokedAt; // block number, 0 while active
    }

    event LaneKeyAdded(Lane indexed lane, address indexed key, uint64 atBlock);
    event LaneKeyRevoked(Lane indexed lane, address indexed key, uint64 atBlock, string reason);

    error InvalidLane();
    error ZeroKey();
    error LaneOccupied(Lane lane);
    error KeyAlreadyUsed(address key);
    error KeyNotActive(address key);

    /// @notice Owner only. Reverts if the lane already has an active key or the key was ever used.
    function addLaneKey(Lane lane, address key) external;

    /// @notice Owner only. The key can never anchor or sign ledger actions again.
    function revokeLaneKey(address key, string calldata reason) external;

    /// @notice Owner only. Revokes `oldKey` and registers `newKey` for the same lane atomically.
    function rotateLaneKey(address oldKey, address newKey, string calldata reason) external;

    function laneOf(address key) external view returns (Lane lane, bool active, uint64 addedAt, uint64 revokedAt);

    function activeKey(Lane lane) external view returns (address);

    /// @notice True if `key` is the active key of `lane`.
    function isActiveFor(address key, Lane lane) external view returns (bool);
}
