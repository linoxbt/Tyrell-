// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IQieId} from "./interfaces/IQieId.sol";

/// @title TestQieId
/// @notice A self-service stand-in for the QIE ID record store, for local chains, QIE testnet (where
///         QIE ID is not deployed) and the playground. Anyone can claim a free name for themselves,
///         transfer it, or let it lapse. Same read interface as the mainnet store. NOT for mainnet.
contract TestQieId is IQieId {
    mapping(bytes32 nameHash => address) public holder;
    mapping(bytes32 nameHash => bool) public lapsed;

    event Claimed(string name, address indexed holder);
    event Transferred(string name, address indexed from, address indexed to);
    event Lapsed(string name);

    error NameTaken(string name);
    error NotHolder(string name);

    function claim(string calldata name) external {
        bytes32 h = keccak256(bytes(name));
        if (holder[h] != address(0) && holder[h] != msg.sender && !lapsed[h]) revert NameTaken(name);
        holder[h] = msg.sender;
        lapsed[h] = false;
        emit Claimed(name, msg.sender);
    }

    function transferName(string calldata name, address to) external {
        bytes32 h = keccak256(bytes(name));
        if (holder[h] != msg.sender) revert NotHolder(name);
        holder[h] = to;
        emit Transferred(name, msg.sender, to);
    }

    /// @notice Simulate an expired free name: the mainnet store reverts on those.
    function lapse(string calldata name) external {
        bytes32 h = keccak256(bytes(name));
        if (holder[h] != msg.sender) revert NotHolder(name);
        lapsed[h] = true;
        emit Lapsed(name);
    }

    function resolveCurrency(string calldata domain, string calldata currency) external view returns (address) {
        bytes32 h = keccak256(bytes(domain));
        if (keccak256(bytes(currency)) != keccak256("qie")) return address(0);
        require(!lapsed[h], "Metadata:domain expired");
        return holder[h];
    }
}
