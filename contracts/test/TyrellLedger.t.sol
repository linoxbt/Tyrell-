// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {ITyrellLedger} from "../src/interfaces/ITyrellLedger.sol";

contract TyrellLedgerTest is Base {
    string internal constant REMOVE = "RemovePayee(bytes32 payeeId,uint256 nonce,uint64 deadline)";
    string internal constant REINSTATE = "ReinstatePayee(bytes32 payeeId,uint256 nonce,uint64 deadline)";

    function _dl() internal view returns (uint64) {
        return uint64(block.timestamp + 1 hours);
    }

    // ------------------------------------------------------------ add payee

    function test_userAddsPayee() public {
        ITyrellLedger.Payee memory p = _payee(landlord, address(usd), 5e6, 5e6, "landlord");
        uint64 dl = _dl();
        bytes memory sig = _addPayeeSig(userPk, p, LANDLORD, 1, dl);
        vm.expectEmit(true, false, false, true, address(ledger));
        emit ITyrellLedger.PayeeAdded(LANDLORD, landlord, address(usd), 5e6, 5e6, "landlord", user);
        ledger.addPayee(p, LANDLORD, 1, dl, sig);

        ITyrellLedger.Payee memory got = ledger.payee(LANDLORD);
        assertEq(got.addr, landlord);
        assertEq(got.token, address(usd));
        assertEq(got.capPerTx, 5e6);
        assertEq(got.capPerDay, 5e6);
        assertEq(got.label, "landlord");
        assertTrue(got.active);
        assertFalse(got.suspended);
        assertEq(ledger.lastNonce(user), 1);
    }

    function test_hashAddPayeeMatchesSpecEncoding() public view {
        ITyrellLedger.Payee memory p = _payee(landlord, address(usd), 5e6, 5e6, "landlord");
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "AddPayee(bytes32 payeeId,address addr,address token,uint128 capPerTx,uint128 capPerDay,string label,uint256 nonce,uint64 deadline)"
                ),
                LANDLORD,
                landlord,
                address(usd),
                uint128(5e6),
                uint128(5e6),
                keccak256("landlord"),
                uint256(1),
                uint64(9)
            )
        );
        assertEq(ledger.hashAddPayee(p, LANDLORD, 1, 9), expected);
    }

    /// The model's keys can never add a payee: agent, wallet and control signatures all fail.
    function test_onlyUserLaneAddsPayee() public {
        ITyrellLedger.Payee memory p = _payee(attacker, address(usd), 5e6, 5e6, "landlord");
        uint64 dl = _dl();
        uint256[3] memory pks = [agentPk, walletPk, controlPk];
        address[3] memory who = [agent, walletKey, control];
        for (uint256 i; i < 3; ++i) {
            bytes memory sig = _addPayeeSig(pks[i], p, LANDLORD, 1, dl);
            vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.WrongLane.selector, who[i]));
            ledger.addPayee(p, LANDLORD, 1, dl, sig);
        }
    }

    function test_revokedUserKeyCannotAdd() public {
        vm.prank(owner);
        reg.revokeLaneKey(user, "lost");
        ITyrellLedger.Payee memory p = _payee(landlord, address(usd), 5e6, 5e6, "landlord");
        uint64 dl = _dl();
        bytes memory sig = _addPayeeSig(userPk, p, LANDLORD, 1, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.WrongLane.selector, user));
        ledger.addPayee(p, LANDLORD, 1, dl, sig);
    }

    function test_signatureCoversEveryField() public {
        ITyrellLedger.Payee memory p = _payee(landlord, address(usd), 5e6, 5e6, "landlord");
        uint64 dl = _dl();
        bytes memory sig = _addPayeeSig(userPk, p, LANDLORD, 1, dl);
        p.addr = attacker; // swap the address after signing
        vm.expectRevert(); // recovers to an unbound address
        ledger.addPayee(p, LANDLORD, 1, dl, sig);
    }

    function test_expiredDeadline() public {
        ITyrellLedger.Payee memory p = _payee(landlord, address(usd), 5e6, 5e6, "landlord");
        uint64 dl = uint64(block.timestamp + 60);
        bytes memory sig = _addPayeeSig(userPk, p, LANDLORD, 1, dl);
        vm.warp(block.timestamp + 61);
        vm.expectRevert(ITyrellLedger.Expired.selector);
        ledger.addPayee(p, LANDLORD, 1, dl, sig);
    }

    function test_nonceReplayAndStaleNonce() public {
        ITyrellLedger.Payee memory p = _payee(landlord, address(usd), 5e6, 5e6, "landlord");
        uint64 dl = _dl();
        bytes memory sig = _addPayeeSig(userPk, p, LANDLORD, 5, dl);
        ledger.addPayee(p, LANDLORD, 5, dl, sig);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.StaleNonce.selector, 5, 5));
        ledger.addPayee(p, LANDLORD, 5, dl, sig);

        bytes32 other = keccak256("payee:school");
        bytes memory sig3 = _addPayeeSig(userPk, p, other, 3, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.StaleNonce.selector, 3, 5));
        ledger.addPayee(p, other, 3, dl, sig3);
    }

    function test_zeroNonceRejected() public {
        ITyrellLedger.Payee memory p = _payee(landlord, address(usd), 5e6, 5e6, "landlord");
        uint64 dl = _dl();
        bytes memory sig = _addPayeeSig(userPk, p, LANDLORD, 0, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.StaleNonce.selector, 0, 0));
        ledger.addPayee(p, LANDLORD, 0, dl, sig);
    }

    function test_duplicatePayeeId() public {
        _addPayee(LANDLORD, landlord, 5e6, 5e6);
        ITyrellLedger.Payee memory p = _payee(attacker, address(usd), 5e6, 5e6, "landlord");
        uint64 dl = _dl();
        bytes memory sig = _addPayeeSig(userPk, p, LANDLORD, 2, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.PayeeExists.selector, LANDLORD));
        ledger.addPayee(p, LANDLORD, 2, dl, sig);
    }

    function test_badPayeeFields() public {
        uint64 dl = _dl();
        ITyrellLedger.Payee[7] memory bad = [
            _payee(address(0), address(usd), 5, 5, "x"),
            _payee(landlord, address(0), 5, 5, "x"),
            _payee(landlord, address(usd), 0, 5, "x"),
            _payee(landlord, address(usd), 6, 5, "x"),
            _payee(landlord, address(usd), 5, 5, ""),
            _payee(landlord, address(usd), 5, 5, "this label is far too long to be accepted by the ledger contract!!"),
            _payee(landlord, address(usd), 5, 5, "x")
        ];
        bytes32[7] memory ids = [LANDLORD, LANDLORD, LANDLORD, LANDLORD, LANDLORD, LANDLORD, bytes32(0)];
        for (uint256 i; i < 7; ++i) {
            bytes memory sig = _addPayeeSig(userPk, bad[i], ids[i], i + 1, dl);
            vm.expectRevert(ITyrellLedger.BadPayee.selector);
            ledger.addPayee(bad[i], ids[i], i + 1, dl, sig);
        }
    }

    // ------------------------------------------------------------ remove / reinstate / suspend

    function test_removeAndReinstate() public {
        _addPayee(LANDLORD, landlord, 5e6, 5e6);
        uint64 dl = _dl();
        ledger.removePayee(LANDLORD, 2, dl, _simpleSig(userPk, REMOVE, LANDLORD, 2, dl));
        assertFalse(ledger.payee(LANDLORD).active);
        (bool ok,, bytes32 code) = ledger.isPayable(LANDLORD, address(usd), 1);
        assertFalse(ok);
        assertEq(code, "PAYEE_REMOVED");

        bytes memory sig1 = _simpleSig(userPk, REMOVE, LANDLORD, 3, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.PayeeNotActive.selector, LANDLORD));
        ledger.removePayee(LANDLORD, 3, dl, sig1);

        ledger.reinstatePayee(LANDLORD, 4, dl, _simpleSig(userPk, REINSTATE, LANDLORD, 4, dl));
        assertTrue(ledger.payee(LANDLORD).active);
    }

    function test_unknownPayee() public {
        uint64 dl = _dl();
        bytes memory sig2 = _simpleSig(userPk, REMOVE, LANDLORD, 1, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.UnknownPayee.selector, LANDLORD));
        ledger.removePayee(LANDLORD, 1, dl, sig2);
    }

    function test_controlCanSuspendButNeverReinstateOrRemove() public {
        _addPayee(LANDLORD, landlord, 5e6, 5e6);
        uint256 seedId = _seed(2, bytes32(uint256(uint160(attacker))));
        uint64 dl = _dl();

        vm.expectEmit(true, false, false, true, address(ledger));
        emit ITyrellLedger.PayeeSuspended(LANDLORD, seedId);
        ledger.suspendPayee(
            LANDLORD, seedId, ++controlNonce, dl, _suspendSig(controlPk, LANDLORD, seedId, controlNonce, dl)
        );
        assertTrue(ledger.payee(LANDLORD).suspended);
        (bool ok,, bytes32 code) = ledger.isPayable(LANDLORD, address(usd), 1);
        assertFalse(ok);
        assertEq(code, "PAYEE_SUSPENDED");

        bytes memory sig3 = _simpleSig(controlPk, REINSTATE, LANDLORD, 99, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.WrongLane.selector, control));
        ledger.reinstatePayee(LANDLORD, 99, dl, sig3);
        bytes memory sig4 = _simpleSig(controlPk, REMOVE, LANDLORD, 99, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.WrongLane.selector, control));
        ledger.removePayee(LANDLORD, 99, dl, sig4);

        // Only the user lane lifts a suspension.
        ledger.reinstatePayee(LANDLORD, ++userNonce, dl, _simpleSig(userPk, REINSTATE, LANDLORD, userNonce, dl));
        assertFalse(ledger.payee(LANDLORD).suspended);
    }

    function test_userCannotSuspend() public {
        _addPayee(LANDLORD, landlord, 5e6, 5e6);
        uint256 seedId = _seed(1, keccak256("m"));
        uint64 dl = _dl();
        bytes memory sig5 = _suspendSig(userPk, LANDLORD, seedId, 50, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.WrongLane.selector, user));
        ledger.suspendPayee(LANDLORD, seedId, 50, dl, sig5);
    }

    function test_suspendNeedsActiveSeed() public {
        _addPayee(LANDLORD, landlord, 5e6, 5e6);
        uint64 dl = _dl();
        bytes memory sig6 = _suspendSig(controlPk, LANDLORD, 7, 1, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.UnknownSeed.selector, 7));
        ledger.suspendPayee(LANDLORD, 7, 1, dl, sig6);
    }

    // ------------------------------------------------------------ quarantine

    function test_controlSeedsQuarantine() public {
        bytes32 v = bytes32(uint256(uint160(attacker)));
        uint64 dl = _dl();
        bytes memory sig = _seedSig(controlPk, 2, v, 0, 0, "bafyreason", 1, dl);
        vm.expectEmit(true, false, false, true, address(ledger));
        emit ITyrellLedger.QuarantineSeeded(1, 2, v, 0, 0, "bafyreason", control);
        uint256 id = ledger.seedQuarantine(2, v, 0, 0, "bafyreason", 1, dl, sig);
        assertEq(id, 1);
        ITyrellLedger.Seed memory s = ledger.seed(1);
        assertEq(s.seedType, 2);
        assertEq(s.value, v);
        assertEq(s.signer, control);
        assertFalse(s.released);
        uint256[] memory act = ledger.activeSeeds();
        assertEq(act.length, 1);
        assertEq(act[0], 1);
    }

    function test_signerWindowSeed() public {
        bytes32 v = bytes32(uint256(uint160(walletKey)));
        uint64 dl = _dl();
        bytes memory sig = _seedSig(controlPk, 3, v, 100, 200, "bafy", 1, dl);
        ledger.seedQuarantine(3, v, 100, 200, "bafy", 1, dl, sig);
        ITyrellLedger.Seed memory s = ledger.seed(1);
        assertEq(s.fromBlock, 100);
        assertEq(s.toBlock, 200);
    }

    function _expectBadSeed(uint8 t, bytes32 v, uint64 from, uint64 to, string memory cid, uint256 nonce) internal {
        uint64 dl = _dl();
        bytes memory sig = _seedSig(controlPk, t, v, from, to, cid, nonce, dl);
        vm.expectRevert(ITyrellLedger.BadSeed.selector);
        ledger.seedQuarantine(t, v, from, to, cid, nonce, dl, sig);
    }

    function test_badSeeds() public {
        bytes32 v = keccak256("v");
        _expectBadSeed(0, v, 0, 0, "bafy", 1); // type out of range (low)
        _expectBadSeed(5, v, 0, 0, "bafy", 2); // type out of range (high)
        _expectBadSeed(2, bytes32(0), 0, 0, "bafy", 3); // zero value
        _expectBadSeed(2, v, 0, 0, "", 4); // empty reason
        _expectBadSeed(3, v, 10, 5, "bafy", 5); // inverted signer window
        _expectBadSeed(1, v, 1, 2, "bafy", 6); // block range on a non-window seed
    }

    function test_userCannotSeed() public {
        bytes32 v = keccak256("v");
        uint64 dl = _dl();
        bytes memory sig = _seedSig(userPk, 1, v, 0, 0, "bafy", 1, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.WrongLane.selector, user));
        ledger.seedQuarantine(1, v, 0, 0, "bafy", 1, dl, sig);
    }

    /// T-16: releasing a seed with the control key reverts; the user key works.
    function test_T16_releaseNeedsUserKey() public {
        uint256 seedId = _seed(2, keccak256("token"));
        uint64 dl = _dl();
        bytes memory sig7 = _releaseSig(controlPk, seedId, "bafywhy", 50, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.WrongLane.selector, control));
        ledger.releaseQuarantine(seedId, "bafywhy", 50, dl, sig7);

        vm.expectEmit(true, false, false, true, address(ledger));
        emit ITyrellLedger.QuarantineReleased(seedId, "bafywhy", user);
        ledger.releaseQuarantine(seedId, "bafywhy", 1, dl, _releaseSig(userPk, seedId, "bafywhy", 1, dl));
        assertTrue(ledger.seed(seedId).released);
        assertEq(ledger.activeSeeds().length, 0);
    }

    function test_releaseChecks() public {
        uint64 dl = _dl();
        bytes memory sig8 = _releaseSig(userPk, 1, "bafy", 1, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.UnknownSeed.selector, 1));
        ledger.releaseQuarantine(1, "bafy", 1, dl, sig8);

        uint256 seedId = _seed(4, keccak256("turn"));
        bytes memory sig9 = _releaseSig(userPk, seedId, "", 2, dl);
        vm.expectRevert(ITyrellLedger.BadSeed.selector);
        ledger.releaseQuarantine(seedId, "", 2, dl, sig9);

        ledger.releaseQuarantine(seedId, "bafy", 3, dl, _releaseSig(userPk, seedId, "bafy", 3, dl));
        bytes memory sig10 = _releaseSig(userPk, seedId, "bafy", 4, dl);
        vm.expectRevert(abi.encodeWithSelector(ITyrellLedger.SeedReleased.selector, seedId));
        ledger.releaseQuarantine(seedId, "bafy", 4, dl, sig10);
    }

    function test_activeSeedsTracksReleases() public {
        uint256 a = _seed(1, keccak256("a"));
        uint256 b = _seed(1, keccak256("b"));
        uint256 c = _seed(1, keccak256("c"));
        uint64 dl = _dl();
        ledger.releaseQuarantine(b, "bafy", 1, dl, _releaseSig(userPk, b, "bafy", 1, dl));
        uint256[] memory act = ledger.activeSeeds();
        assertEq(act.length, 2);
        assertTrue((act[0] == a && act[1] == c) || (act[0] == c && act[1] == a));
        assertEq(ledger.seedCount(), 3);
    }

    // ------------------------------------------------------------ isPayable

    function test_isPayableCodes() public {
        _addPayee(LANDLORD, landlord, 5e6, 5e6);
        bool ok;
        address to;
        bytes32 code;
        (ok, to, code) = ledger.isPayable(keccak256("nobody"), address(usd), 1);
        assertEq(code, "UNKNOWN_PAYEE");
        assertEq(to, address(0));
        (ok,, code) = ledger.isPayable(LANDLORD, attacker, 1);
        assertEq(code, "ASSET_MISMATCH");
        (ok,, code) = ledger.isPayable(LANDLORD, address(usd), 0);
        assertEq(code, "ZERO_AMOUNT");
        (ok,, code) = ledger.isPayable(LANDLORD, address(usd), 5e6 + 1);
        assertEq(code, "OVER_CAP");
        (ok, to, code) = ledger.isPayable(LANDLORD, address(usd), 5e6);
        assertTrue(ok);
        assertEq(to, landlord);
        assertEq(code, bytes32(0));
    }
}
