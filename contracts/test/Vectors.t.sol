// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {LaneRegistry} from "../src/LaneRegistry.sol";
import {MemoryAnchor} from "../src/MemoryAnchor.sol";
import {TyrellLedger} from "../src/TyrellLedger.sol";
import {ILaneRegistry} from "../src/interfaces/ILaneRegistry.sol";
import {ITyrellLedger} from "../src/interfaces/ITyrellLedger.sol";

/// @notice Checks the contracts against values computed by the TypeScript core package (test/vectors/core.json),
///         including anchoring and adding a payee with signatures made in TypeScript.
///         Regenerate the file with `pnpm --filter "./packages/core" vectors`.
contract VectorsTest is Test {
    string internal json;
    address internal signer;
    address internal owner = makeAddr("owner");

    function setUp() public {
        json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/core.json"));
        signer = vm.parseJsonAddress(json, ".signer");
        vm.chainId(vm.parseJsonUint(json, ".chainId"));
    }

    function _memory() internal view returns (MemoryAnchor.Memory memory m) {
        m.id = bytes16(vm.parseJsonBytes(json, ".memory.id"));
        m.acct = vm.parseJsonBytes32(json, ".memory.acct");
        m.ns = vm.parseJsonBytes32(json, ".memory.ns");
        m.lane = uint8(vm.parseJsonUint(json, ".memory.lane"));
        m.kind = uint8(vm.parseJsonUint(json, ".memory.kind"));
        m.parentsHash = vm.parseJsonBytes32(json, ".memory.parentsHash");
        m.srcHash = vm.parseJsonBytes32(json, ".memory.srcHash");
        m.turn = bytes16(vm.parseJsonBytes(json, ".memory.turn"));
        m.refBlock = uint64(vm.parseJsonUint(json, ".memory.refBlock"));
        m.bodyHash = vm.parseJsonBytes32(json, ".memory.bodyHash");
        m.bodyLen = uint32(vm.parseJsonUint(json, ".memory.bodyLen"));
    }

    function test_memoryVectorsAndTypeScriptSignatureAnchor() public {
        MemoryAnchor.Memory memory m = _memory();
        address at = vm.parseJsonAddress(json, ".memoryAnchor");
        LaneRegistry reg = new LaneRegistry(owner);
        address submitter = makeAddr("submitter");
        deployCodeTo("MemoryAnchor.sol:MemoryAnchor", abi.encode(owner, reg, m.acct, submitter), at);
        MemoryAnchor anchorC = MemoryAnchor(at);

        assertEq(anchorC.hashMemory(m), vm.parseJsonBytes32(json, ".memory.structHash"), "struct hash");
        assertEq(anchorC.domainSeparator(), vm.parseJsonBytes32(json, ".memory.domainSeparator"), "domain");
        bytes32 digest = vm.parseJsonBytes32(json, ".memory.digest");
        assertEq(anchorC.digestOf(m), digest, "digest");
        bytes memory sig = vm.parseJsonBytes(json, ".memory.signature");
        assertEq(ECDSA.recover(digest, sig), signer, "recover");

        vm.prank(owner);
        reg.addLaneKey(ILaneRegistry.Lane.Agent, signer);
        vm.roll(m.refBlock + 1);
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafyvector");
        (address got,,,) = anchorC.anchorOf(m.id);
        assertEq(got, signer);
    }

    function test_ledgerVectorsAndTypeScriptSignatureAddsPayee() public {
        address at = vm.parseJsonAddress(json, ".tyrellLedger");
        LaneRegistry reg = new LaneRegistry(owner);
        deployCodeTo("TyrellLedger.sol:TyrellLedger", abi.encode(reg), at);
        TyrellLedger ledger = TyrellLedger(at);
        assertEq(ledger.domainSeparator(), vm.parseJsonBytes32(json, ".ledgerDomainSeparator"), "ledger domain");

        ITyrellLedger.Payee memory p = ITyrellLedger.Payee({
            addr: vm.parseJsonAddress(json, ".addPayee.addr"),
            token: vm.parseJsonAddress(json, ".addPayee.token"),
            capPerTx: uint128(vm.parseJsonUint(json, ".addPayee.capPerTx")),
            capPerDay: uint128(vm.parseJsonUint(json, ".addPayee.capPerDay")),
            label: vm.parseJsonString(json, ".addPayee.label"),
            active: false,
            suspended: false
        });
        bytes32 payeeId = vm.parseJsonBytes32(json, ".addPayee.payeeId");
        uint256 nonce = vm.parseJsonUint(json, ".addPayee.nonce");
        uint64 deadline = uint64(vm.parseJsonUint(json, ".addPayee.deadline"));
        assertEq(
            ledger.hashAddPayee(p, payeeId, nonce, deadline),
            vm.parseJsonBytes32(json, ".addPayee.structHash"),
            "AddPayee"
        );

        vm.prank(owner);
        reg.addLaneKey(ILaneRegistry.Lane.User, signer);
        vm.warp(deadline - 60);
        ledger.addPayee(p, payeeId, nonce, deadline, vm.parseJsonBytes(json, ".addPayee.signature"));
        assertEq(ledger.payee(payeeId).addr, p.addr);
    }

    function test_otherLedgerTypehashes() public {
        TyrellLedger ledger = new TyrellLedger(new LaneRegistry(owner));
        bytes32 seedHash = keccak256(
            bytes.concat(
                abi.encode(
                    ledger.SEED_QUARANTINE_TYPEHASH(),
                    uint8(vm.parseJsonUint(json, ".seedQuarantine.seedType")),
                    vm.parseJsonBytes32(json, ".seedQuarantine.seedValue"),
                    uint64(vm.parseJsonUint(json, ".seedQuarantine.fromBlock")),
                    uint64(vm.parseJsonUint(json, ".seedQuarantine.toBlock"))
                ),
                abi.encode(
                    keccak256(bytes(vm.parseJsonString(json, ".seedQuarantine.reasonCid"))),
                    vm.parseJsonUint(json, ".seedQuarantine.nonce"),
                    uint64(vm.parseJsonUint(json, ".seedQuarantine.deadline"))
                )
            )
        );
        assertEq(seedHash, vm.parseJsonBytes32(json, ".seedQuarantine.structHash"), "SeedQuarantine");

        bytes32 releaseHash = keccak256(
            abi.encode(
                ledger.RELEASE_QUARANTINE_TYPEHASH(),
                vm.parseJsonUint(json, ".releaseQuarantine.seedId"),
                keccak256(bytes(vm.parseJsonString(json, ".releaseQuarantine.reasonCid"))),
                vm.parseJsonUint(json, ".releaseQuarantine.nonce"),
                uint64(vm.parseJsonUint(json, ".releaseQuarantine.deadline"))
            )
        );
        assertEq(releaseHash, vm.parseJsonBytes32(json, ".releaseQuarantine.structHash"), "ReleaseQuarantine");

        bytes32 suspendHash = keccak256(
            abi.encode(
                ledger.SUSPEND_PAYEE_TYPEHASH(),
                vm.parseJsonBytes32(json, ".suspendPayee.payeeId"),
                vm.parseJsonUint(json, ".suspendPayee.seedId"),
                vm.parseJsonUint(json, ".suspendPayee.nonce"),
                uint64(vm.parseJsonUint(json, ".suspendPayee.deadline"))
            )
        );
        assertEq(suspendHash, vm.parseJsonBytes32(json, ".suspendPayee.structHash"), "SuspendPayee");

        bytes32 removeHash = keccak256(
            abi.encode(
                ledger.REMOVE_PAYEE_TYPEHASH(),
                vm.parseJsonBytes32(json, ".removePayee.payeeId"),
                vm.parseJsonUint(json, ".removePayee.nonce"),
                uint64(vm.parseJsonUint(json, ".removePayee.deadline"))
            )
        );
        assertEq(removeHash, vm.parseJsonBytes32(json, ".removePayee.structHash"), "RemovePayee");
    }
}
