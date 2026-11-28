// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LaneRegistry} from "../src/LaneRegistry.sol";
import {MemoryAnchor} from "../src/MemoryAnchor.sol";
import {TyrellLedger} from "../src/TyrellLedger.sol";
import {GuardedVault} from "../src/GuardedVault.sol";
import {TyrellTestUSD} from "../src/TyrellTestUSD.sol";
import {ILaneRegistry} from "../src/interfaces/ILaneRegistry.sol";
import {ITyrellLedger} from "../src/interfaces/ITyrellLedger.sol";

/// @dev Full deployment as in production: owner wallet, four lane keys, a submitter (control gas key)
///      and a vault signer key, each distinct (I-12).
abstract contract Base is Test {
    LaneRegistry internal reg;
    MemoryAnchor internal anchorC;
    TyrellLedger internal ledger;
    GuardedVault internal vault;
    TyrellTestUSD internal usd;

    bytes32 internal constant ACCT = keccak256("tyrell-test-account");
    bytes32 internal constant NS_MEM = keccak256("steward.mem");
    // Typehashes written out from the spec, independent of the contracts, so encoding drift fails a test.
    bytes32 internal constant SPEC_MEMORY_TYPEHASH = keccak256(
        "Memory(bytes16 id,bytes32 acct,bytes32 ns,uint8 lane,uint8 kind,bytes32 parentsHash,bytes32 srcHash,bytes16 turn,uint64 refBlock,bytes32 bodyHash,uint32 bodyLen)"
    );

    address internal owner = makeAddr("owner");
    address internal submitter = makeAddr("submitter");
    address internal user;
    uint256 internal userPk;
    address internal agent;
    uint256 internal agentPk;
    address internal walletKey;
    uint256 internal walletPk;
    address internal control;
    uint256 internal controlPk;
    address internal vaultSigner = makeAddr("vaultSigner");

    address internal landlord = makeAddr("landlord");
    address internal attacker = makeAddr("attacker");
    bytes32 internal constant LANDLORD = keccak256("payee:landlord");

    uint256 internal userNonce;
    uint256 internal controlNonce;

    function setUp() public virtual {
        (user, userPk) = makeAddrAndKey("userLane");
        (agent, agentPk) = makeAddrAndKey("agentLane");
        (walletKey, walletPk) = makeAddrAndKey("walletLane");
        (control, controlPk) = makeAddrAndKey("controlLane");

        reg = new LaneRegistry(owner);
        anchorC = new MemoryAnchor(owner, reg, ACCT, submitter);
        ledger = new TyrellLedger(reg);
        vault = new GuardedVault(owner, ledger, vaultSigner, address(0)); // control pauses through its lane
        usd = new TyrellTestUSD(owner);

        vm.startPrank(owner);
        reg.addLaneKey(ILaneRegistry.Lane.User, user);
        reg.addLaneKey(ILaneRegistry.Lane.Agent, agent);
        reg.addLaneKey(ILaneRegistry.Lane.Wallet, walletKey);
        reg.addLaneKey(ILaneRegistry.Lane.Control, control);
        usd.mint(address(vault), 10e6);
        vault.setGlobalDailyCap(address(usd), 8e6);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- memory helpers

    function _mem(bytes16 id, uint8 lane) internal view returns (MemoryAnchor.Memory memory m) {
        m = MemoryAnchor.Memory({
            id: id,
            acct: ACCT,
            ns: NS_MEM,
            lane: lane,
            kind: lane == 3 ? 2 : 3,
            parentsHash: keccak256(""),
            srcHash: keccak256("[]"),
            turn: bytes16(0),
            refBlock: uint64(block.number),
            bodyHash: keccak256("hello"),
            bodyLen: 5
        });
    }

    function _specDigest(MemoryAnchor.Memory memory m) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SPEC_MEMORY_TYPEHASH,
                m.id,
                m.acct,
                m.ns,
                m.lane,
                m.kind,
                m.parentsHash,
                m.srcHash,
                m.turn,
                m.refBlock,
                m.bodyHash,
                m.bodyLen
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Tyrell"),
                keccak256("1"),
                block.chainid,
                address(anchorC)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signMem(uint256 pk, MemoryAnchor.Memory memory m) internal view returns (bytes memory) {
        return _sign(pk, _specDigest(m));
    }

    // ---------------------------------------------------------------- ledger helpers

    function _ledgerDigest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", ledger.domainSeparator(), structHash));
    }

    function _payee(address addr, address token, uint128 cap, uint128 daily, string memory label)
        internal
        pure
        returns (ITyrellLedger.Payee memory)
    {
        return ITyrellLedger.Payee({
            addr: addr, token: token, capPerTx: cap, capPerDay: daily, label: label, active: false, suspended: false
        });
    }

    function _addPayeeSig(uint256 pk, ITyrellLedger.Payee memory p, bytes32 id, uint256 nonce, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 h = keccak256(
            abi.encode(
                keccak256(
                    "AddPayee(bytes32 payeeId,address addr,address token,uint128 capPerTx,uint128 capPerDay,string label,uint256 nonce,uint64 deadline)"
                ),
                id,
                p.addr,
                p.token,
                p.capPerTx,
                p.capPerDay,
                keccak256(bytes(p.label)),
                nonce,
                deadline
            )
        );
        return _sign(pk, _ledgerDigest(h));
    }

    function _addPayee(bytes32 id, address addr, uint128 cap, uint128 daily) internal {
        ITyrellLedger.Payee memory p = _payee(addr, address(usd), cap, daily, "landlord");
        uint64 dl = uint64(block.timestamp + 1 hours);
        ledger.addPayee(p, id, ++userNonce, dl, _addPayeeSig(userPk, p, id, userNonce, dl));
    }

    function _seedSig(
        uint256 pk,
        uint8 t,
        bytes32 v,
        uint64 from,
        uint64 to,
        string memory cid,
        uint256 nonce,
        uint64 dl
    ) internal view returns (bytes memory) {
        // All fields are static, so concatenating two abi.encode halves equals one abi.encode
        // (split only to stay under the stack limit).
        bytes memory head = abi.encode(
            keccak256(
                "SeedQuarantine(uint8 seedType,bytes32 seedValue,uint64 fromBlock,uint64 toBlock,string reasonCid,uint256 nonce,uint64 deadline)"
            ),
            t,
            v,
            from,
            to
        );
        bytes32 h = keccak256(bytes.concat(head, abi.encode(keccak256(bytes(cid)), nonce, dl)));
        return _sign(pk, _ledgerDigest(h));
    }

    function _seed(uint8 t, bytes32 v) internal returns (uint256) {
        uint64 dl = uint64(block.timestamp + 1 hours);
        uint256 nonce = ++controlNonce;
        bytes memory sig = _seedSig(controlPk, t, v, 0, 0, "bafyreason", nonce, dl);
        return ledger.seedQuarantine(t, v, 0, 0, "bafyreason", nonce, dl, sig);
    }

    function _releaseSig(uint256 pk, uint256 seedId, string memory cid, uint256 nonce, uint64 dl)
        internal
        view
        returns (bytes memory)
    {
        bytes32 h = keccak256(
            abi.encode(
                keccak256("ReleaseQuarantine(uint256 seedId,string reasonCid,uint256 nonce,uint64 deadline)"),
                seedId,
                keccak256(bytes(cid)),
                nonce,
                dl
            )
        );
        return _sign(pk, _ledgerDigest(h));
    }

    function _simpleSig(uint256 pk, string memory typeString, bytes32 payeeId, uint256 nonce, uint64 dl)
        internal
        view
        returns (bytes memory)
    {
        return _sign(pk, _ledgerDigest(keccak256(abi.encode(keccak256(bytes(typeString)), payeeId, nonce, dl))));
    }

    function _suspendSig(uint256 pk, bytes32 payeeId, uint256 seedId, uint256 nonce, uint64 dl)
        internal
        view
        returns (bytes memory)
    {
        bytes32 h = keccak256(
            abi.encode(
                keccak256("SuspendPayee(bytes32 payeeId,uint256 seedId,uint256 nonce,uint64 deadline)"),
                payeeId,
                seedId,
                nonce,
                dl
            )
        );
        return _sign(pk, _ledgerDigest(h));
    }
}
