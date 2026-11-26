// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Base} from "./Base.t.sol";
import {GuardedVault} from "../src/GuardedVault.sol";
import {TyrellTestUSD} from "../src/TyrellTestUSD.sol";
import {ITyrellLedger} from "../src/interfaces/ITyrellLedger.sol";

contract GuardedVaultTest is Base {
    bytes16 internal constant D1 = bytes16(keccak256("decision-1"));

    function setUp() public override {
        super.setUp();
        _addPayee(LANDLORD, landlord, 5e6, 5e6); // cap 5, daily 5 (spec M1 acceptance run)
    }

    function _pay(uint256 amount, bytes16 d) internal {
        vm.prank(vaultSigner);
        vault.pay(LANDLORD, address(usd), amount, d);
    }

    function test_payHappyPath() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit GuardedVault.Paid(LANDLORD, landlord, address(usd), 5e6, D1);
        _pay(5e6, D1);
        assertEq(usd.balanceOf(landlord), 5e6);
        assertEq(usd.balanceOf(address(vault)), 5e6);
        assertEq(vault.spentToday(LANDLORD), 5e6);
        assertEq(vault.spentTodayGlobal(address(usd)), 5e6);
        assertTrue(vault.decisionUsed(D1));
    }

    /// T-11: the signer key calls pay for an unregistered payee directly.
    function test_T11_signerCannotPayUnregistered() public {
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotPayable.selector, bytes32("UNKNOWN_PAYEE")));
        vm.prank(vaultSigner);
        vault.pay(keccak256("payee:attacker"), address(usd), 1e6, D1);
        assertEq(usd.balanceOf(attacker), 0);
    }

    function test_onlySigner() public {
        address[3] memory who = [attacker, owner, control];
        for (uint256 i; i < 3; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    IAccessControl.AccessControlUnauthorizedAccount.selector, who[i], vault.SIGNER_ROLE()
                )
            );
            vm.prank(who[i]);
            vault.pay(LANDLORD, address(usd), 1e6, D1);
        }
    }

    function test_overCapPerTx() public {
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotPayable.selector, bytes32("OVER_CAP")));
        _pay(5e6 + 1, D1);
    }

    function test_zeroAmount() public {
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotPayable.selector, bytes32("ZERO_AMOUNT")));
        _pay(0, D1);
    }

    function test_dailyCapAndRollover() public {
        _pay(3e6, D1);
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotPayable.selector, bytes32("OVER_DAILY_CAP")));
        _pay(3e6, bytes16(keccak256("d2")));
        _pay(2e6, bytes16(keccak256("d3")));
        assertEq(vault.spentToday(LANDLORD), 5e6);

        // The day boundary is UTC midnight: block.timestamp / 1 days.
        vm.warp((block.timestamp / 1 days + 1) * 1 days);
        assertEq(vault.spentToday(LANDLORD), 0);
        _pay(3e6, bytes16(keccak256("d4")));
    }

    function test_dayBoundaryIsUtcMidnight() public {
        uint256 midnight = (block.timestamp / 1 days + 1) * 1 days;
        vm.warp(midnight - 1);
        _pay(5e6, D1);
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotPayable.selector, bytes32("OVER_DAILY_CAP")));
        _pay(1, bytes16(keccak256("d2")));
        vm.warp(midnight);
        _pay(1, bytes16(keccak256("d3")));
    }

    function test_globalDailyCapAcrossPayees() public {
        bytes32 school = keccak256("payee:school");
        _addPayee(school, makeAddr("school"), 5e6, 5e6);
        _pay(5e6, D1);
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotPayable.selector, bytes32("OVER_GLOBAL_DAILY_CAP")));
        vm.prank(vaultSigner);
        vault.pay(school, address(usd), 4e6, bytes16(keccak256("d2"))); // 5 + 4 > global 8
        vm.prank(vaultSigner);
        vault.pay(school, address(usd), 3e6, bytes16(keccak256("d3")));
    }

    function test_tokenWithoutGlobalCapCannotBePaid() public {
        vm.prank(owner);
        vault.setGlobalDailyCap(address(usd), 0);
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotPayable.selector, bytes32("OVER_GLOBAL_DAILY_CAP")));
        _pay(1e6, D1);
    }

    function test_wrongToken() public {
        TyrellTestUSD fake = new TyrellTestUSD(owner); // a look-alike "QUSDC"
        vm.prank(owner);
        fake.mint(address(vault), 10e6);
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotPayable.selector, bytes32("ASSET_MISMATCH")));
        vm.prank(vaultSigner);
        vault.pay(LANDLORD, address(fake), 1e6, D1);
    }

    function test_suspendedAndRemovedPayeesBlocked() public {
        uint256 seedId = _seed(2, keccak256("poisoned"));
        uint64 dl = uint64(block.timestamp + 1 hours);
        bytes memory sig = _suspendSig(controlPk, LANDLORD, seedId, ++controlNonce, dl);
        ledger.suspendPayee(LANDLORD, seedId, controlNonce, dl, sig);
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotPayable.selector, bytes32("PAYEE_SUSPENDED")));
        _pay(1e6, D1);

        bytes memory sig2 =
            _simpleSig(userPk, "RemovePayee(bytes32 payeeId,uint256 nonce,uint64 deadline)", LANDLORD, ++userNonce, dl);
        ledger.removePayee(LANDLORD, userNonce, dl, sig2);
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotPayable.selector, bytes32("PAYEE_REMOVED")));
        _pay(1e6, D1);
    }

    function test_decisionIdOnceAndNonZero() public {
        _pay(1e6, D1);
        vm.expectRevert(GuardedVault.BadDecision.selector);
        _pay(1e6, D1);
        vm.expectRevert(GuardedVault.BadDecision.selector);
        _pay(1e6, bytes16(0));
    }

    function test_pauseByControlUnpauseByOwnerOnly() public {
        vm.prank(control);
        vault.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        _pay(1e6, D1);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, control, vault.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(control);
        vault.unpause();

        vm.prank(owner);
        vault.unpause();
        _pay(1e6, D1);
    }

    function test_attackerCannotPause() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, vault.PAUSER_ROLE()
            )
        );
        vm.prank(attacker);
        vault.pause();
    }

    function test_withdrawOwnerOnly() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, vaultSigner, vault.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(vaultSigner);
        vault.withdraw(address(usd), attacker, 1e6);

        vm.expectEmit(true, false, false, true, address(vault));
        emit GuardedVault.Withdrawn(owner, address(usd), 10e6);
        vm.prank(owner);
        vault.withdraw(address(usd), owner, 10e6);
        assertEq(usd.balanceOf(owner), 10e6);

        vm.expectRevert(GuardedVault.ZeroAddress.selector);
        vm.prank(owner);
        vault.withdraw(address(usd), address(0), 1);
    }

    function test_setGlobalCapOwnerOnly() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, control, vault.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(control);
        vault.setGlobalDailyCap(address(usd), type(uint256).max);
    }

    function test_rejectsNativeCoin() public {
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_constructorChecks() public {
        vm.expectRevert(GuardedVault.ZeroAddress.selector);
        new GuardedVault(address(0), ledger, vaultSigner, control);
        vm.expectRevert(GuardedVault.ZeroAddress.selector);
        new GuardedVault(owner, ITyrellLedger(address(0)), vaultSigner, control);
    }

    /// Fuzz: whatever the signer asks for, money only reaches registered payees, within caps.
    function testFuzz_payNeverToNonPayeeOrOverCap(
        bytes32 payeeId,
        bool useRealPayee,
        bool useRealToken,
        uint256 amount,
        bytes16 d
    ) public {
        bytes32 id = useRealPayee ? LANDLORD : payeeId;
        address token = useRealToken ? address(usd) : makeAddr("fakeToken");
        amount = bound(amount, 0, 20e6);
        uint256 before = usd.balanceOf(address(vault));

        vm.prank(vaultSigner);
        (bool ok,) = address(vault).call(abi.encodeCall(GuardedVault.pay, (id, token, amount, d)));

        uint256 out = before - usd.balanceOf(address(vault));
        if (ok) {
            assertEq(id, LANDLORD);
            assertEq(token, address(usd));
            assertGt(amount, 0);
            assertLe(amount, 5e6);
            assertEq(usd.balanceOf(landlord), out);
        } else {
            assertEq(out, 0);
        }
        assertLe(vault.spentToday(LANDLORD), 5e6);
    }
}
