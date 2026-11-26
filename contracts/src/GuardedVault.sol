// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITyrellLedger} from "./interfaces/ITyrellLedger.sol";

/// @title GuardedVault
/// @notice Holds Steward's QUSDC. `pay` is the only way money leaves to anyone but the owner, and it
///         re-checks on-chain what the policy engine checked off-chain (spec section 8.4, I-5):
///         the payee is registered, active and not suspended, the token matches, 0 < amount <= capPerTx,
///         the payee's spend today stays within capPerDay, and the vault-wide spend today stays within
///         the token's global daily cap. A leaked signer key can therefore lose at most one day's
///         capped spend, and only to payees the human registered.
/// @dev "Today" is block.timestamp / 1 days (UTC), the same boundary the policy engine uses for R4.
///      A token with no global daily cap set cannot be paid at all (fail closed).
contract GuardedVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    ITyrellLedger public immutable ledger;

    mapping(bytes32 payeeId => mapping(uint256 day => uint256)) private _spent;
    mapping(address token => mapping(uint256 day => uint256)) private _spentGlobal;
    mapping(address token => uint256) public globalDailyCap;
    mapping(bytes16 decisionId => bool) public decisionUsed;

    event Paid(bytes32 indexed payeeId, address indexed to, address token, uint256 amount, bytes16 decisionId);
    event Withdrawn(address indexed to, address token, uint256 amount);
    event GlobalDailyCapSet(address indexed token, uint256 cap);

    error NotPayable(bytes32 code);
    error BadDecision();
    error ZeroAddress();

    constructor(address admin, ITyrellLedger ledger_, address signer, address controlPauser) {
        if (admin == address(0) || address(ledger_) == address(0)) revert ZeroAddress();
        ledger = ledger_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        if (signer != address(0)) _grantRole(SIGNER_ROLE, signer);
        if (controlPauser != address(0)) _grantRole(PAUSER_ROLE, controlPauser);
    }

    /// @notice Pays a registered payee for an ALLOW decision. Signer role only.
    function pay(bytes32 payeeId, address token, uint256 amount, bytes16 decisionId)
        external
        onlyRole(SIGNER_ROLE)
        whenNotPaused
        nonReentrant
    {
        if (decisionId == bytes16(0) || decisionUsed[decisionId]) revert BadDecision();

        (bool ok, address to, bytes32 code) = ledger.isPayable(payeeId, token, amount);
        if (!ok) revert NotPayable(code);

        uint256 day = block.timestamp / 1 days;
        uint256 spent = _spent[payeeId][day] + amount;
        if (spent > ledger.payee(payeeId).capPerDay) revert NotPayable("OVER_DAILY_CAP");
        uint256 spentGlobal = _spentGlobal[token][day] + amount;
        if (spentGlobal > globalDailyCap[token]) revert NotPayable("OVER_GLOBAL_DAILY_CAP");

        decisionUsed[decisionId] = true;
        _spent[payeeId][day] = spent;
        _spentGlobal[token][day] = spentGlobal;
        IERC20(token).safeTransfer(to, amount);
        emit Paid(payeeId, to, token, amount, decisionId);
    }

    /// @notice Owner only: take funds back out of the vault.
    function withdraw(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(to, token, amount);
    }

    /// @notice Owner only: the most the vault may pay out in `token` per UTC day, across all payees.
    function setGlobalDailyCap(address token, uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        globalDailyCap[token] = cap;
        emit GlobalDailyCapSet(token, cap);
    }

    /// @notice Owner or control: stop all payments.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Owner only.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function spentToday(bytes32 payeeId) external view returns (uint256) {
        return _spent[payeeId][block.timestamp / 1 days];
    }

    function spentTodayGlobal(address token) external view returns (uint256) {
        return _spentGlobal[token][block.timestamp / 1 days];
    }
}
