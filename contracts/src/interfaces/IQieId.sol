// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The read side of a QIE ID record store. On QIE mainnet this is the ERC1967 proxy at
///         0x8777d01d509D0eA71FB38F88F79867da558d5018 (implementation "PaymentMetadata"), the same
///         store the QIE MCP server reads: resolveCurrency("name.qie", "qie") returns the owner's
///         QIE address, the zero address for a name with no record, and reverts for an expired free name.
interface IQieId {
    function resolveCurrency(string calldata domain, string calldata currency) external view returns (address);
}
