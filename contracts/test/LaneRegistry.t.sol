// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base} from "./Base.t.sol";
import {ILaneRegistry} from "../src/interfaces/ILaneRegistry.sol";
import {LaneRegistry} from "../src/LaneRegistry.sol";

contract LaneRegistryTest is Base {
    function test_setUpBindsFourLanes() public view {
        assertEq(reg.activeKey(ILaneRegistry.Lane.User), user);
        assertEq(reg.activeKey(ILaneRegistry.Lane.Agent), agent);
        assertEq(reg.activeKey(ILaneRegistry.Lane.Wallet), walletKey);
        assertEq(reg.activeKey(ILaneRegistry.Lane.Control), control);
        (ILaneRegistry.Lane lane, bool active, uint64 addedAt, uint64 revokedAt) = reg.laneOf(agent);
        assertEq(uint8(lane), 2);
        assertTrue(active);
        assertEq(addedAt, block.number);
        assertEq(revokedAt, 0);
        assertTrue(reg.isActiveFor(agent, ILaneRegistry.Lane.Agent));
        assertFalse(reg.isActiveFor(agent, ILaneRegistry.Lane.User));
    }

    function test_addEmitsEvent() public {
        LaneRegistry fresh = new LaneRegistry(owner);
        vm.expectEmit(true, true, false, true, address(fresh));
        emit ILaneRegistry.LaneKeyAdded(ILaneRegistry.Lane.User, user, uint64(block.number));
        vm.prank(owner);
        fresh.addLaneKey(ILaneRegistry.Lane.User, user);
    }

    function test_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vm.prank(attacker);
        reg.addLaneKey(ILaneRegistry.Lane.User, attacker);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vm.prank(attacker);
        reg.revokeLaneKey(user, "x");

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vm.prank(attacker);
        reg.rotateLaneKey(user, attacker, "x");
    }

    function test_oneActiveKeyPerLane() public {
        vm.expectRevert(abi.encodeWithSelector(ILaneRegistry.LaneOccupied.selector, ILaneRegistry.Lane.User));
        vm.prank(owner);
        reg.addLaneKey(ILaneRegistry.Lane.User, makeAddr("second"));
    }

    function test_keyCannotJoinTwoLanes() public {
        vm.startPrank(owner);
        reg.revokeLaneKey(user, "free the lane");
        vm.expectRevert(abi.encodeWithSelector(ILaneRegistry.KeyAlreadyUsed.selector, agent));
        reg.addLaneKey(ILaneRegistry.Lane.User, agent);
        vm.stopPrank();
    }

    function test_revokedKeyCanNeverBeReAdded() public {
        vm.startPrank(owner);
        reg.revokeLaneKey(walletKey, "leaked");
        vm.expectRevert(abi.encodeWithSelector(ILaneRegistry.KeyAlreadyUsed.selector, walletKey));
        reg.addLaneKey(ILaneRegistry.Lane.Wallet, walletKey);
        vm.stopPrank();
    }

    function test_invalidLaneAndZeroKey() public {
        vm.startPrank(owner);
        reg.revokeLaneKey(user, "x");
        vm.expectRevert(ILaneRegistry.InvalidLane.selector);
        reg.addLaneKey(ILaneRegistry.Lane.None, makeAddr("k"));
        vm.expectRevert(ILaneRegistry.ZeroKey.selector);
        reg.addLaneKey(ILaneRegistry.Lane.User, address(0));
        vm.stopPrank();
    }

    function test_invalidLaneOutOfRange() public {
        // An out-of-range enum value reverts during ABI decoding.
        (bool ok,) = address(reg).call(abi.encodeWithSelector(reg.addLaneKey.selector, uint8(5), makeAddr("k")));
        assertFalse(ok);
    }

    function test_revoke() public {
        vm.roll(block.number + 10);
        vm.expectEmit(true, true, false, true, address(reg));
        emit ILaneRegistry.LaneKeyRevoked(ILaneRegistry.Lane.Wallet, walletKey, uint64(block.number), "leaked");
        vm.prank(owner);
        reg.revokeLaneKey(walletKey, "leaked");
        (ILaneRegistry.Lane lane, bool active,, uint64 revokedAt) = reg.laneOf(walletKey);
        assertEq(uint8(lane), 3, "lane kept for historical binding");
        assertFalse(active);
        assertEq(revokedAt, block.number);
        assertEq(reg.activeKey(ILaneRegistry.Lane.Wallet), address(0));
    }

    function test_revokeTwiceOrUnknownReverts() public {
        vm.startPrank(owner);
        reg.revokeLaneKey(walletKey, "x");
        vm.expectRevert(abi.encodeWithSelector(ILaneRegistry.KeyNotActive.selector, walletKey));
        reg.revokeLaneKey(walletKey, "x");
        vm.expectRevert(abi.encodeWithSelector(ILaneRegistry.KeyNotActive.selector, attacker));
        reg.revokeLaneKey(attacker, "x");
        vm.stopPrank();
    }

    function test_rotateIsAtomic() public {
        address fresh = makeAddr("agent2");
        vm.prank(owner);
        reg.rotateLaneKey(agent, fresh, "rotate");
        assertEq(reg.activeKey(ILaneRegistry.Lane.Agent), fresh);
        (, bool oldActive,,) = reg.laneOf(agent);
        assertFalse(oldActive);
    }

    function test_rotateToUsedKeyRevertsWhole() public {
        vm.expectRevert(abi.encodeWithSelector(ILaneRegistry.KeyAlreadyUsed.selector, user));
        vm.prank(owner);
        reg.rotateLaneKey(agent, user, "bad");
        assertEq(reg.activeKey(ILaneRegistry.Lane.Agent), agent, "old key still active after failed rotate");
    }

    function test_ownershipIsTwoStep() public {
        address next = makeAddr("nextOwner");
        vm.prank(owner);
        reg.transferOwnership(next);
        assertEq(reg.owner(), owner);
        vm.prank(next);
        reg.acceptOwnership();
        assertEq(reg.owner(), next);
    }

    function test_ownershipCannotBeRenounced() public {
        vm.expectRevert(LaneRegistry.NoRenounce.selector);
        vm.prank(owner);
        reg.renounceOwnership();
        assertEq(reg.owner(), owner);
    }
}
