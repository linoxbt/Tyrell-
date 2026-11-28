// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ILaneRegistry} from "./interfaces/ILaneRegistry.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @title MemoryAnchor
/// @notice Anchors the signed digest of every Tyrell memory envelope, with the IPFS CID of its
///         encrypted body. The chain's MemoryAnchored log is the memory inventory (spec section 8.2).
/// @dev Invariant I-1: the EIP-712 signature must recover to the key LaneRegistry reports active for
///      `m.lane`. An ID anchors once; there is no delete or overwrite path.
///      Only the submitter (control's gas key) may anchor: the CID is not covered by the lane
///      signature, so an open submitter would let anyone front-run a pending anchor with a junk CID
///      and claim its ID.
///      Agents network (phase A): once the owner links this deployment's agent (`linkAgent`), an agent-lane
///      memory also needs that agent to be active (not revoked, banned or frozen, its human still bound to
///      their QIE ID), to hold the MEMORY permission, and its registered key to be the signer.
///      Ownership can be handed over (two-step) but never renounced.
contract MemoryAnchor is EIP712, Ownable2Step {
    struct Memory {
        bytes16 id;
        bytes32 acct;
        bytes32 ns;
        uint8 lane;
        uint8 kind;
        bytes32 parentsHash; // keccak256(abi.encodePacked(sorted parent ids))
        bytes32 srcHash; // keccak256(RFC 8785 canonical JSON of src)
        bytes16 turn;
        uint64 refBlock;
        bytes32 bodyHash; // keccak256(body bytes, UTF-8)
        uint32 bodyLen;
    }

    struct Anchor {
        address signer;
        uint8 lane;
        uint64 atBlock;
        bytes32 structHash; // EIP-712 struct hash of the Memory: commits to every header field
    }

    bytes32 public constant MEMORY_TYPEHASH = keccak256(
        "Memory(bytes16 id,bytes32 acct,bytes32 ns,uint8 lane,uint8 kind,bytes32 parentsHash,bytes32 srcHash,bytes16 turn,uint64 refBlock,bytes32 bodyHash,uint32 bodyLen)"
    );
    uint256 public constant MAX_BATCH = 20;
    uint32 public constant MAX_BODY_LEN = 8192;
    uint32 public constant PERM_MEMORY = 2;

    ILaneRegistry public immutable registry;
    bytes32 public immutable acct;
    address public submitter;
    /// @notice Phase A: the agent registry and this deployment's agent id (zero registry = not linked).
    IAgentRegistry public agentRegistry;
    uint256 public agentId;

    mapping(bytes16 id => Anchor) private _anchors;

    event MemoryAnchored(
        bytes16 indexed id,
        uint8 indexed lane,
        address indexed signer,
        bytes32 ns,
        bytes32 structHash,
        bytes32 parentsHash,
        bytes32 bodyHash,
        string cid,
        uint64 refBlock
    );
    event SubmitterChanged(address indexed previous, address indexed current);
    event AgentLinked(address indexed registry, uint256 indexed agentId);

    error UnknownSigner();
    error LaneMismatch();
    error KeyRevoked();
    error AlreadyAnchored();
    error BadAccount();
    error NotSubmitter();
    error BadMemory();
    error BatchSize();
    error NoRenounce();
    error AgentKeyMismatch();
    error AgentBlocked(bytes32 code);
    error NoMemoryPermission();

    modifier onlySubmitter() {
        if (msg.sender != submitter) revert NotSubmitter();
        _;
    }

    constructor(address owner_, ILaneRegistry registry_, bytes32 acct_, address submitter_)
        EIP712("Tyrell", "1")
        Ownable(owner_)
    {
        registry = registry_;
        acct = acct_;
        _setSubmitter(submitter_);
    }

    /// @notice Owner only. Points anchoring at a new control gas key.
    function setSubmitter(address submitter_) external onlyOwner {
        _setSubmitter(submitter_);
    }

    /// @notice Owner only. Gate agent-lane memories on agent `agentId_` in `registry_` (zero registry unlinks).
    function linkAgent(IAgentRegistry registry_, uint256 agentId_) external onlyOwner {
        agentRegistry = registry_;
        agentId = address(registry_) == address(0) ? 0 : agentId_;
        emit AgentLinked(address(registry_), agentId);
    }

    /// @notice Disabled: hand ownership over with transferOwnership instead.
    function renounceOwnership() public pure override {
        revert NoRenounce();
    }

    function anchor(Memory calldata m, bytes calldata sig, string calldata cid) external onlySubmitter {
        _anchor(m, sig, cid);
    }

    function anchorBatch(Memory[] calldata ms, bytes[] calldata sigs, string[] calldata cids) external onlySubmitter {
        uint256 n = ms.length;
        if (n == 0 || n > MAX_BATCH || sigs.length != n || cids.length != n) revert BatchSize();
        for (uint256 i; i < n; ++i) {
            _anchor(ms[i], sigs[i], cids[i]);
        }
    }

    function anchorOf(bytes16 id)
        external
        view
        returns (address signer, uint8 lane, uint64 atBlock, bytes32 structHash)
    {
        Anchor memory a = _anchors[id];
        return (a.signer, a.lane, a.atBlock, a.structHash);
    }

    /// @notice EIP-712 struct hash of a memory header, as signed by its lane key.
    function hashMemory(Memory calldata m) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MEMORY_TYPEHASH,
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
    }

    /// @notice The full EIP-712 digest a lane key signs for `m`.
    function digestOf(Memory calldata m) external view returns (bytes32) {
        return _hashTypedDataV4(hashMemory(m));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _anchor(Memory calldata m, bytes calldata sig, string calldata cid) private {
        if (m.acct != acct) revert BadAccount();
        if (
            m.id == bytes16(0) || m.lane == 0 || m.lane > uint8(ILaneRegistry.Lane.Control) || m.kind == 0 || m.kind > 5
                || m.bodyLen > MAX_BODY_LEN || m.refBlock > block.number || bytes(cid).length == 0
        ) revert BadMemory();
        if (_anchors[m.id].atBlock != 0) revert AlreadyAnchored();

        bytes32 structHash = hashMemory(m);
        address signer = _laneSigner(structHash, sig, m.lane);
        _anchors[m.id] = Anchor({signer: signer, lane: m.lane, atBlock: uint64(block.number), structHash: structHash});
        _emitAnchored(m, signer, structHash, cid);
    }

    /// @dev Recovers the signer and checks it is the active LaneRegistry key for `lane` (I-1).
    function _laneSigner(bytes32 structHash, bytes calldata sig, uint8 lane) private view returns (address signer) {
        ECDSA.RecoverError err;
        (signer, err,) = ECDSA.tryRecover(_hashTypedDataV4(structHash), sig);
        if (err != ECDSA.RecoverError.NoError) revert UnknownSigner();
        (ILaneRegistry.Lane bound, bool active,,) = registry.laneOf(signer);
        if (bound == ILaneRegistry.Lane.None) revert UnknownSigner();
        if (!active) revert KeyRevoked();
        if (uint8(bound) != lane) revert LaneMismatch();
        if (lane == uint8(ILaneRegistry.Lane.Agent) && address(agentRegistry) != address(0)) _agentGate(signer);
    }

    /// @dev Phase A: the linked agent must be live, hold MEMORY, and be registered with this key.
    function _agentGate(address signer) private view {
        IAgentRegistry r = agentRegistry;
        uint256 id = agentId;
        (bool ok, bytes32 code) = r.status(id);
        if (!ok) revert AgentBlocked(code);
        if (r.agent(id).key != signer) revert AgentKeyMismatch();
        if (!r.hasPermission(id, PERM_MEMORY)) revert NoMemoryPermission();
    }

    function _emitAnchored(Memory calldata m, address signer, bytes32 structHash, string calldata cid) private {
        emit MemoryAnchored(m.id, m.lane, signer, m.ns, structHash, m.parentsHash, m.bodyHash, cid, m.refBlock);
    }

    function _setSubmitter(address submitter_) private {
        emit SubmitterChanged(submitter, submitter_);
        submitter = submitter_;
    }
}
