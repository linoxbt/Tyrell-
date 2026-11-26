// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {LaneRegistry} from "../src/LaneRegistry.sol";
import {MemoryAnchor} from "../src/MemoryAnchor.sol";
import {GuardedVault} from "../src/GuardedVault.sol";
import {TyrellLedger} from "../src/TyrellLedger.sol";
import {TyrellTestUSD} from "../src/TyrellTestUSD.sol";
import {ILaneRegistry} from "../src/interfaces/ILaneRegistry.sol";

/// @dev Drives the vault with random pay attempts from the signer and from strangers, over random time.
contract VaultHandler is Test {
    GuardedVault internal vault;
    TyrellTestUSD internal usd;
    TyrellTestUSD internal fake;
    address internal signer;
    bytes32[2] internal payees;

    uint256 public ghostPaid;
    uint256 public ghostDecisions;

    constructor(GuardedVault v, TyrellTestUSD u, TyrellTestUSD f, address s, bytes32 p0, bytes32 p1) {
        vault = v;
        usd = u;
        fake = f;
        signer = s;
        payees = [p0, p1];
    }

    function pay(uint256 payeeSeed, bool realToken, uint256 amount, bool asSigner) external {
        bytes32 id = payeeSeed % 3 == 2 ? keccak256(abi.encode(payeeSeed)) : payees[payeeSeed % 3];
        address token = realToken ? address(usd) : address(fake);
        amount = bound(amount, 0, 7e6);
        bytes16 d = bytes16(uint128(++ghostDecisions));
        vm.prank(asSigner ? signer : address(uint160(payeeSeed | 1)));
        try vault.pay(id, token, amount, d) {
            if (token == address(usd)) ghostPaid += amount;
        } catch {}
    }

    function passTime(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 2 days));
    }
}

/// @dev Drives anchoring with random keys while keys are revoked and rotated underneath.
contract AnchorHandler is Test {
    LaneRegistry internal reg;
    MemoryAnchor internal anchorC;
    address internal owner;
    address internal submitter;
    bytes32 internal acct;

    uint256[] internal pks;
    mapping(address => bool) public revokedAt;
    uint256 internal idCounter;
    uint256 internal keyCounter;

    bool public ghostRevokedKeyAnchored;
    uint256 public ghostAnchors;

    constructor(LaneRegistry r, MemoryAnchor a, address o, address s, bytes32 acct_, uint256[4] memory lanePks) {
        reg = r;
        anchorC = a;
        owner = o;
        submitter = s;
        acct = acct_;
        for (uint256 i; i < 4; ++i) {
            pks.push(lanePks[i]);
        }
    }

    function anchor(uint256 keySeed, uint8 laneSeed) external {
        uint256 pk = pks[keySeed % pks.length];
        address signer = vm.addr(pk);
        MemoryAnchor.Memory memory m = MemoryAnchor.Memory({
            id: bytes16(uint128(++idCounter)),
            acct: acct,
            ns: keccak256("steward.mem"),
            lane: uint8(bound(laneSeed, 1, 4)),
            kind: 3,
            parentsHash: bytes32(0),
            srcHash: bytes32(0),
            turn: bytes16(0),
            refBlock: uint64(block.number),
            bodyHash: keccak256(abi.encode(idCounter)),
            bodyLen: 1
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, anchorC.digestOf(m));
        vm.prank(submitter);
        try anchorC.anchor(m, abi.encodePacked(r, s, v), "bafycid") {
            ++ghostAnchors;
            if (revokedAt[signer]) ghostRevokedKeyAnchored = true;
        } catch {}
    }

    function revoke(uint256 keySeed) external {
        address key = vm.addr(pks[keySeed % pks.length]);
        vm.prank(owner);
        try reg.revokeLaneKey(key, "fuzz") {
            revokedAt[key] = true;
        } catch {}
    }

    function rotate(uint256 keySeed) external {
        address oldKey = vm.addr(pks[keySeed % pks.length]);
        uint256 newPk = uint256(keccak256(abi.encode("rotated", ++keyCounter))) % 1e70 + 1;
        vm.prank(owner);
        try reg.rotateLaneKey(oldKey, vm.addr(newPk), "fuzz") {
            revokedAt[oldKey] = true;
            pks.push(newPk);
        } catch {}
    }

    function roll(uint256 blocks) external {
        vm.roll(block.number + bound(blocks, 0, 50));
    }
}

contract VaultInvariants is Base {
    VaultHandler internal handler;
    TyrellTestUSD internal fake;
    bytes32 internal constant SCHOOL = keccak256("payee:school");
    address internal school = makeAddr("school");
    uint256 internal initial;

    function setUp() public override {
        super.setUp();
        _addPayee(LANDLORD, landlord, 5e6, 5e6);
        _addPayee(SCHOOL, school, 3e6, 4e6);
        fake = new TyrellTestUSD(owner);
        vm.startPrank(owner);
        usd.mint(address(vault), 990e6); // 1,000 in total
        fake.mint(address(vault), 1_000e6);
        vm.stopPrank();
        initial = usd.balanceOf(address(vault));
        handler = new VaultHandler(vault, usd, fake, vaultSigner, LANDLORD, SCHOOL);
        targetContract(address(handler));
    }

    /// Spec 17: vault outflow to non-owner addresses equals the sum of Paid amounts to registered payees.
    function invariant_outflowOnlyToRegisteredPayees() public view {
        uint256 outflow = initial - usd.balanceOf(address(vault));
        assertEq(outflow, handler.ghostPaid());
        assertEq(usd.balanceOf(landlord) + usd.balanceOf(school), outflow);
        assertEq(fake.balanceOf(address(vault)), 1_000e6, "wrong-token payments never leave");
    }

    function invariant_capsHold() public view {
        assertLe(vault.spentToday(LANDLORD), 5e6);
        assertLe(vault.spentToday(SCHOOL), 4e6);
        assertLe(vault.spentTodayGlobal(address(usd)), vault.globalDailyCap(address(usd)));
    }
}

contract AnchorInvariants is Base {
    AnchorHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new AnchorHandler(reg, anchorC, owner, submitter, ACCT, [userPk, agentPk, walletPk, controlPk]);
        targetContract(address(handler));
    }

    /// Spec 17: a revoked key never appears as the signer of a later MemoryAnchored.
    function invariant_revokedKeyNeverAnchors() public view {
        assertFalse(handler.ghostRevokedKeyAnchored());
    }

    /// At most one active key per lane, whatever the sequence of revokes and rotations.
    function invariant_oneActiveKeyPerLane() public view {
        for (uint8 l = 1; l <= 4; ++l) {
            address k = reg.activeKey(ILaneRegistry.Lane(l));
            if (k != address(0)) assertTrue(reg.isActiveFor(k, ILaneRegistry.Lane(l)));
        }
    }
}
