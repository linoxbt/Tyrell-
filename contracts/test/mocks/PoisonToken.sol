// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only attacker token: any name (the attack lives there), free minting, and the
///         ability to emit forged Transfer events, as address-poisoning tokens do on real chains.
contract PoisonToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Emits Transfer(from, to, amount) without moving balances: a fake "transferFrom(victim, lookalike, 0)".
    function forgeTransfer(address from, address to, uint256 amount) external {
        emit Transfer(from, to, amount);
    }
}
