// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base} from "./Base.t.sol";
import {MemoryAnchor} from "../src/MemoryAnchor.sol";
import {ILaneRegistry} from "../src/interfaces/ILaneRegistry.sol";

contract MemoryAnchorTest is Base {
    bytes16 internal constant ID1 = bytes16(keccak256("memory-1"));

    function test_typehashAndDigestMatchSpec() public view {
        assertEq(anchorC.MEMORY_TYPEHASH(), SPEC_MEMORY_TYPEHASH);
        MemoryAnchor.Memory memory m = _mem(ID1, 2);
        assertEq(anchorC.digestOf(m), _specDigest(m));
    }

    function test_anchorHappyPath() public {
        MemoryAnchor.Memory memory m = _mem(ID1, 2);
        bytes memory sig = _signMem(agentPk, m);
        vm.roll(block.number + 3);
        vm.expectEmit(true, true, true, true, address(anchorC));
        emit MemoryAnchor.MemoryAnchored(
            m.id, 2, agent, m.ns, anchorC.hashMemory(m), m.parentsHash, m.bodyHash, "bafycid", m.refBlock
        );
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafycid");

        (address signer, uint8 lane, uint64 atBlock, bytes32 structHash) = anchorC.anchorOf(ID1);
        assertEq(signer, agent);
        assertEq(lane, 2);
        assertEq(atBlock, block.number);
        assertEq(structHash, anchorC.hashMemory(m));
    }

    function test_everyLaneCanAnchorItsOwn() public {
        uint256[4] memory pks = [userPk, agentPk, walletPk, controlPk];
        for (uint8 lane = 1; lane <= 4; ++lane) {
            MemoryAnchor.Memory memory m = _mem(bytes16(uint128(lane)), lane);
            vm.prank(submitter);
            anchorC.anchor(m, _signMem(pks[lane - 1], m), "bafycid");
        }
    }

    function test_onlySubmitter() public {
        MemoryAnchor.Memory memory m = _mem(ID1, 2);
        bytes memory sig = _signMem(agentPk, m);
        vm.expectRevert(MemoryAnchor.NotSubmitter.selector);
        vm.prank(attacker);
        anchorC.anchor(m, sig, "bafyjunk");
    }

    /// Front-running with a junk CID is impossible: the real anchor still lands with its own CID.
    function test_frontRunWithJunkCidBlocked() public {
        MemoryAnchor.Memory memory m = _mem(ID1, 2);
        bytes memory sig = _signMem(agentPk, m);
        vm.prank(attacker);
        vm.expectRevert(MemoryAnchor.NotSubmitter.selector);
        anchorC.anchor(m, sig, "bafyjunk");
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafyreal");
    }

    function test_setSubmitterOnlyOwner() public {
        address next = makeAddr("submitter2");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vm.prank(attacker);
        anchorC.setSubmitter(next);

        vm.expectEmit(true, true, false, false, address(anchorC));
        emit MemoryAnchor.SubmitterChanged(submitter, next);
        vm.prank(owner);
        anchorC.setSubmitter(next);
        assertEq(anchorC.submitter(), next);
    }

    /// T-03: the agent key signs an envelope claiming the user lane.
    function test_T03_agentClaimingUserLaneReverts() public {
        MemoryAnchor.Memory memory m = _mem(ID1, 1);
        bytes memory sig = _signMem(agentPk, m);
        vm.expectRevert(MemoryAnchor.LaneMismatch.selector);
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafycid");
    }

    /// T-04: revoke the wallet key, then try to anchor with it.
    function test_T04_revokedKeyReverts() public {
        vm.prank(owner);
        reg.revokeLaneKey(walletKey, "leaked");
        MemoryAnchor.Memory memory m = _mem(ID1, 3);
        bytes memory sig = _signMem(walletPk, m);
        vm.expectRevert(MemoryAnchor.KeyRevoked.selector);
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafycid");
    }

    function test_rotatedKeyAnchorsOldKeyRefused() public {
        (address agent2, uint256 agent2Pk) = makeAddrAndKey("agentLane2");
        vm.prank(owner);
        reg.rotateLaneKey(agent, agent2, "rotate");

        MemoryAnchor.Memory memory m = _mem(ID1, 2);
        vm.prank(submitter);
        vm.expectRevert(MemoryAnchor.KeyRevoked.selector);
        anchorC.anchor(m, _signMem(agentPk, m), "bafycid");

        vm.prank(submitter);
        anchorC.anchor(m, _signMem(agent2Pk, m), "bafycid");
        (address signer,,,) = anchorC.anchorOf(ID1);
        assertEq(signer, agent2);
    }

    function test_unknownSignerReverts() public {
        (, uint256 strangerPk) = makeAddrAndKey("stranger");
        MemoryAnchor.Memory memory m = _mem(ID1, 3);
        bytes memory sig = _signMem(strangerPk, m);
        vm.expectRevert(MemoryAnchor.UnknownSigner.selector);
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafycid");
    }

    function test_malformedSignatureReverts() public {
        MemoryAnchor.Memory memory m = _mem(ID1, 2);
        vm.startPrank(submitter);
        vm.expectRevert(MemoryAnchor.UnknownSigner.selector);
        anchorC.anchor(m, hex"1234", "bafycid");
        vm.expectRevert(MemoryAnchor.UnknownSigner.selector);
        anchorC.anchor(m, new bytes(65), "bafycid");
        vm.stopPrank();
    }

    function test_highSSignatureRejected() public {
        MemoryAnchor.Memory memory m = _mem(ID1, 2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, _specDigest(m));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141; // key-scan: allow (secp256k1 order)
        bytes memory malleated = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(MemoryAnchor.UnknownSigner.selector);
        vm.prank(submitter);
        anchorC.anchor(m, malleated, "bafycid");
    }

    function test_tamperedFieldBreaksSignature() public {
        MemoryAnchor.Memory memory m = _mem(ID1, 2);
        bytes memory sig = _signMem(agentPk, m);
        m.bodyHash = keccak256("tampered");
        vm.expectRevert(); // recovers to some other address: UnknownSigner
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafycid");
    }

    function test_badAccountReverts() public {
        MemoryAnchor.Memory memory m = _mem(ID1, 2);
        m.acct = keccak256("other-account");
        bytes memory sig = _signMem(agentPk, m);
        vm.expectRevert(MemoryAnchor.BadAccount.selector);
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafycid");
    }

    function test_anchorOnceOnly() public {
        MemoryAnchor.Memory memory m = _mem(ID1, 2);
        bytes memory sig = _signMem(agentPk, m);
        vm.startPrank(submitter);
        anchorC.anchor(m, sig, "bafycid");
        vm.expectRevert(MemoryAnchor.AlreadyAnchored.selector);
        anchorC.anchor(m, sig, "bafyother");
        vm.stopPrank();
    }

    function test_badMemoryFields() public {
        vm.startPrank(submitter);
        MemoryAnchor.Memory memory m;

        m = _mem(bytes16(0), 2);
        vm.expectRevert(MemoryAnchor.BadMemory.selector);
        anchorC.anchor(m, _signMem(agentPk, m), "bafycid");

        m = _mem(ID1, 0);
        vm.expectRevert(MemoryAnchor.BadMemory.selector);
        anchorC.anchor(m, _signMem(agentPk, m), "bafycid");

        m = _mem(ID1, 5);
        vm.expectRevert(MemoryAnchor.BadMemory.selector);
        anchorC.anchor(m, _signMem(agentPk, m), "bafycid");

        m = _mem(ID1, 2);
        m.kind = 6;
        vm.expectRevert(MemoryAnchor.BadMemory.selector);
        anchorC.anchor(m, _signMem(agentPk, m), "bafycid");

        m = _mem(ID1, 2);
        m.kind = 0;
        vm.expectRevert(MemoryAnchor.BadMemory.selector);
        anchorC.anchor(m, _signMem(agentPk, m), "bafycid");

        m = _mem(ID1, 2);
        m.bodyLen = 8193;
        vm.expectRevert(MemoryAnchor.BadMemory.selector);
        anchorC.anchor(m, _signMem(agentPk, m), "bafycid");

        m = _mem(ID1, 2);
        m.refBlock = uint64(block.number + 1);
        vm.expectRevert(MemoryAnchor.BadMemory.selector);
        anchorC.anchor(m, _signMem(agentPk, m), "bafycid");

        m = _mem(ID1, 2);
        vm.expectRevert(MemoryAnchor.BadMemory.selector);
        anchorC.anchor(m, _signMem(agentPk, m), "");
        vm.stopPrank();
    }

    function test_batch() public {
        uint256 n = 20;
        MemoryAnchor.Memory[] memory ms = new MemoryAnchor.Memory[](n);
        bytes[] memory sigs = new bytes[](n);
        string[] memory cids = new string[](n);
        for (uint256 i; i < n; ++i) {
            ms[i] = _mem(bytes16(uint128(i + 1)), 3);
            sigs[i] = _signMem(walletPk, ms[i]);
            cids[i] = "bafycid";
        }
        vm.prank(submitter);
        anchorC.anchorBatch(ms, sigs, cids);
        (address signer,,,) = anchorC.anchorOf(bytes16(uint128(20)));
        assertEq(signer, walletKey);
    }

    function test_batchIsAtomic() public {
        MemoryAnchor.Memory[] memory ms = new MemoryAnchor.Memory[](2);
        bytes[] memory sigs = new bytes[](2);
        string[] memory cids = new string[](2);
        ms[0] = _mem(bytes16(uint128(1)), 3);
        sigs[0] = _signMem(walletPk, ms[0]);
        ms[1] = _mem(bytes16(uint128(2)), 1); // wallet key claiming user lane
        sigs[1] = _signMem(walletPk, ms[1]);
        cids[0] = "a";
        cids[1] = "b";
        vm.expectRevert(MemoryAnchor.LaneMismatch.selector);
        vm.prank(submitter);
        anchorC.anchorBatch(ms, sigs, cids);
        (,, uint64 atBlock,) = anchorC.anchorOf(bytes16(uint128(1)));
        assertEq(atBlock, 0, "first memory rolled back");
    }

    function test_batchSizeChecks() public {
        vm.startPrank(submitter);
        vm.expectRevert(MemoryAnchor.BatchSize.selector);
        anchorC.anchorBatch(new MemoryAnchor.Memory[](0), new bytes[](0), new string[](0));
        vm.expectRevert(MemoryAnchor.BatchSize.selector);
        anchorC.anchorBatch(new MemoryAnchor.Memory[](21), new bytes[](21), new string[](21));
        vm.expectRevert(MemoryAnchor.BatchSize.selector);
        anchorC.anchorBatch(new MemoryAnchor.Memory[](2), new bytes[](1), new string[](2));
        vm.expectRevert(MemoryAnchor.BatchSize.selector);
        anchorC.anchorBatch(new MemoryAnchor.Memory[](2), new bytes[](2), new string[](1));
        vm.stopPrank();
    }

    function test_domainSeparatorBindsChainAndContract() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Tyrell"),
                keccak256("1"),
                block.chainid,
                address(anchorC)
            )
        );
        assertEq(anchorC.domainSeparator(), expected);
    }

    function test_signatureNotReplayableOnAnotherDeployment() public {
        MemoryAnchor other = new MemoryAnchor(owner, reg, ACCT, submitter);
        MemoryAnchor.Memory memory m = _mem(ID1, 2);
        bytes memory sig = _signMem(agentPk, m); // signed for anchorC's domain
        vm.expectRevert(MemoryAnchor.UnknownSigner.selector);
        vm.prank(submitter);
        other.anchor(m, sig, "bafycid");
    }

    /// Fuzz: anchoring with a random key only succeeds when it is the active key of the claimed lane.
    function testFuzz_onlyActiveLaneKeysAnchor(uint256 pkSeed, uint8 laneSeed, bool useLaneKey) public {
        uint8 lane = uint8(bound(laneSeed, 1, 4));
        uint256[4] memory pks = [userPk, agentPk, walletPk, controlPk];
        uint256 pk = useLaneKey ? pks[bound(pkSeed, 0, 3)] : bound(pkSeed, 1, 1e70);
        address signer = vm.addr(pk);
        MemoryAnchor.Memory memory m = _mem(bytes16(keccak256(abi.encode(pkSeed, laneSeed))), lane);
        bytes memory sig = _signMem(pk, m);
        bool shouldPass = reg.isActiveFor(signer, ILaneRegistry.Lane(lane));
        vm.prank(submitter);
        (bool ok,) = address(anchorC).call(abi.encodeCall(MemoryAnchor.anchor, (m, sig, "bafycid")));
        assertEq(ok, shouldPass);
    }

    function test_ownershipCannotBeRenounced() public {
        vm.expectRevert(MemoryAnchor.NoRenounce.selector);
        vm.prank(owner);
        anchorC.renounceOwnership();
        assertEq(anchorC.owner(), owner);
    }
}
