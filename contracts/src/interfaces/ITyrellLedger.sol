// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

interface ITyrellLedger {
    struct Payee {
        address addr;
        address token;
        uint128 capPerTx;
        uint128 capPerDay;
        string label;
        bool active;
        bool suspended;
    }

    /// @dev seedType: 1 memory, 2 source, 3 signer-window, 4 turn (spec section 7).
    struct Seed {
        uint8 seedType;
        bytes32 value;
        uint64 fromBlock;
        uint64 toBlock;
        string reasonCid;
        address signer;
        bool released;
    }

    event PayeeAdded(
        bytes32 indexed payeeId,
        address addr,
        address token,
        uint128 capPerTx,
        uint128 capPerDay,
        string label,
        address signer
    );
    event PayeeRemoved(bytes32 indexed payeeId, address signer);
    event PayeeSuspended(bytes32 indexed payeeId, uint256 seedId);
    event PayeeReinstated(bytes32 indexed payeeId, address signer);
    event QuarantineSeeded(
        uint256 indexed seedId,
        uint8 seedType,
        bytes32 seedValue,
        uint64 fromBlock,
        uint64 toBlock,
        string reasonCid,
        address signer
    );
    event QuarantineReleased(uint256 indexed seedId, string reasonCid, address signer);

    error WrongLane(address signer);
    error Expired();
    error StaleNonce(uint256 nonce, uint256 lastUsed);
    error BadPayee();
    error PayeeExists(bytes32 payeeId);
    error UnknownPayee(bytes32 payeeId);
    error PayeeNotActive(bytes32 payeeId);
    error BadSeed();
    error UnknownSeed(uint256 seedId);
    error SeedReleased(uint256 seedId);

    // user-lane EIP-712 signatures
    function addPayee(Payee calldata p, bytes32 payeeId, uint256 nonce, uint64 deadline, bytes calldata userSig)
        external;
    function removePayee(bytes32 payeeId, uint256 nonce, uint64 deadline, bytes calldata userSig) external;
    function reinstatePayee(bytes32 payeeId, uint256 nonce, uint64 deadline, bytes calldata userSig) external;
    function releaseQuarantine(
        uint256 seedId,
        string calldata reasonCid,
        uint256 nonce,
        uint64 deadline,
        bytes calldata userSig
    ) external;

    // control-lane EIP-712 signatures
    function seedQuarantine(
        uint8 seedType,
        bytes32 seedValue,
        uint64 fromBlock,
        uint64 toBlock,
        string calldata reasonCid,
        uint256 nonce,
        uint64 deadline,
        bytes calldata controlSig
    ) external returns (uint256 seedId);
    function suspendPayee(bytes32 payeeId, uint256 seedId, uint256 nonce, uint64 deadline, bytes calldata controlSig)
        external;

    function payee(bytes32 payeeId) external view returns (Payee memory);
    function seed(uint256 seedId) external view returns (Seed memory);
    function lastNonce(address signer) external view returns (uint256);

    /// @notice Static payment rules. The vault adds the daily caps. `code` is a short reason when !ok.
    function isPayable(bytes32 payeeId, address token, uint256 amount)
        external
        view
        returns (bool ok, address to, bytes32 code);
    function activeSeeds() external view returns (uint256[] memory);
}
