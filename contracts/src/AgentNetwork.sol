// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @title AgentNetwork
/// @notice Phase B of the agents network: what lets agents of different humans deal with each other.
///
///         Bonds      every agent that wants to message or deal posts a bond (at least `minBond`).
///         Reports    a QIE-ID-bound human reports another human's agent, with evidence and a report bond.
///         Disputes   the accused human may contest within `contestWindow` by matching the bond; a contested
///                    report goes to the `arbiter`; an uncontested one is upheld when the window closes.
///         Penalties  an upheld report slashes `slashBps` of the agent's bond to the reporter; after `banAfter`
///                    upheld reports the agent is banned in the registry, for good. A dismissed report sends
///                    the reporter's bond to the accused human and counts against the reporter.
///         Reputation a 0..1000 score from on-chain history: completed deals, upheld reports, bond.
///         A2A        agents sign EIP-712 messages to each other (verifiable here), and pay each other through
///                    escrowed deals that count against the paying agent's limits and its human's quota.
///
///         Money only moves on a human's call: agents sign messages, humans fund, confirm and contest.
contract AgentNetwork is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum ReportStatus {
        None,
        Open,
        Contested,
        Upheld,
        Dismissed
    }

    enum DealStatus {
        None,
        Open,
        Completed,
        Cancelled,
        Reclaimed
    }

    struct Report {
        uint256 agentId;
        address reporter;
        address accused; // the agent's human when filed
        uint8 category;
        bytes32 evidenceHash;
        string evidenceCid;
        uint64 filedAt;
        ReportStatus status;
        uint256 slashed;
    }

    struct Deal {
        uint256 fromAgent;
        uint256 toAgent;
        address payer; // fromAgent's human
        address payee; // toAgent's human
        address token;
        uint256 amount;
        bytes32 termsHash;
        uint64 deadline;
        DealStatus status;
    }

    struct Record {
        uint32 dealsCompleted;
        uint32 reportsUpheld;
        uint32 reportsDismissed;
        uint128 volume;
    }

    bytes32 public constant AGENT_MESSAGE_TYPEHASH =
        keccak256("AgentMessage(uint256 fromAgent,uint256 toAgent,bytes32 bodyHash,uint256 nonce,uint64 deadline)");
    uint32 private constant PERM_MESSAGE = 4;
    uint32 private constant PERM_DEAL = 8;

    IAgentRegistry public immutable registry;
    IERC20 public immutable bondToken;
    address public immutable arbiter;
    uint256 public immutable minBond;
    uint256 public immutable reportBond;
    uint64 public immutable contestWindow;
    uint16 public immutable slashBps;
    uint8 public immutable banAfter;

    mapping(uint256 agentId => uint256) public bondOf;
    mapping(uint256 agentId => uint256) public openReports;
    mapping(uint256 agentId => Record) private _records;
    mapping(address human => uint32) public falseReports;
    Report[] private _reports; // id = index + 1
    Deal[] private _deals; // id = index + 1

    event Bonded(uint256 indexed agentId, address indexed from, uint256 amount, uint256 total);
    event BondWithdrawn(uint256 indexed agentId, address indexed to, uint256 amount, uint256 total);
    event ReportFiled(uint256 indexed reportId, uint256 indexed agentId, address indexed reporter, uint8 category, bytes32 evidenceHash, string evidenceCid);
    event ReportContested(uint256 indexed reportId, address indexed accused);
    event ReportUpheld(uint256 indexed reportId, uint256 indexed agentId, uint256 slashed, bool banned);
    event ReportDismissed(uint256 indexed reportId, uint256 indexed agentId);
    event DealOpened(uint256 indexed dealId, uint256 indexed fromAgent, uint256 indexed toAgent, address token, uint256 amount, bytes32 termsHash, uint64 deadline);
    event DealCompleted(uint256 indexed dealId);
    event DealCancelled(uint256 indexed dealId);
    event DealReclaimed(uint256 indexed dealId);

    error NotBound(address human);
    error NotHumanOf(uint256 agentId);
    error AgentNotActive(uint256 agentId, bytes32 code);
    error SelfReport();
    error OpenReports(uint256 agentId);
    error BelowMinBond(uint256 agentId);
    error BadAmount();
    error UnknownReport(uint256 reportId);
    error UnknownDeal(uint256 dealId);
    error WrongStatus();
    error WindowClosed();
    error WindowOpen();
    error OnlyArbiter();
    error SameHuman();
    error NotPermitted(uint256 agentId);
    error NotBonded(uint256 agentId);
    error DeadlinePassed();
    error DeadlineNotPassed();
    error BadParams();

    constructor(
        IAgentRegistry registry_,
        IERC20 bondToken_,
        address arbiter_,
        uint256 minBond_,
        uint256 reportBond_,
        uint64 contestWindow_,
        uint16 slashBps_,
        uint8 banAfter_
    ) EIP712("TyrellAgentNetwork", "1") {
        if (
            address(registry_) == address(0) || address(bondToken_) == address(0) || arbiter_ == address(0) || minBond_ == 0
                || reportBond_ == 0 || contestWindow_ == 0 || slashBps_ == 0 || slashBps_ > 10_000 || banAfter_ == 0
        ) revert BadParams();
        registry = registry_;
        bondToken = bondToken_;
        arbiter = arbiter_;
        minBond = minBond_;
        reportBond = reportBond_;
        contestWindow = contestWindow_;
        slashBps = slashBps_;
        banAfter = banAfter_;
    }

    // ------------------------------------------------------------------ bonds

    /// @notice Add to an agent's bond. Anyone may top up; only the agent's human can withdraw.
    function bond(uint256 agentId, uint256 amount) external nonReentrant {
        if (amount == 0) revert BadAmount();
        registry.humanOf(agentId); // reverts for unknown agents
        bondToken.safeTransferFrom(msg.sender, address(this), amount);
        bondOf[agentId] += amount;
        emit Bonded(agentId, msg.sender, amount, bondOf[agentId]);
    }

    /// @notice Withdraw bond. Never while a report against the agent is open; and an active agent must
    ///         keep at least `minBond` (or withdraw everything and leave the network).
    function withdrawBond(uint256 agentId, uint256 amount) external nonReentrant {
        if (registry.humanOf(agentId) != msg.sender) revert NotHumanOf(agentId);
        if (openReports[agentId] != 0) revert OpenReports(agentId);
        uint256 b = bondOf[agentId];
        if (amount == 0 || amount > b) revert BadAmount();
        uint256 left = b - amount;
        if (left != 0 && left < minBond) revert BelowMinBond(agentId);
        bondOf[agentId] = left;
        bondToken.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(agentId, msg.sender, amount, left);
    }

    function isBonded(uint256 agentId) public view returns (bool) {
        return bondOf[agentId] >= minBond;
    }

    // ------------------------------------------------------------------ reports and disputes

    /// @notice Report an agent. The reporter must be a human bound to a QIE ID (accountable), may not
    ///         report their own agent, and posts `reportBond`.
    function fileReport(uint256 agentId, uint8 category, bytes32 evidenceHash, string calldata evidenceCid)
        external
        nonReentrant
        returns (uint256 reportId)
    {
        if (!registry.isBound(msg.sender)) revert NotBound(msg.sender);
        address accused = registry.humanOf(agentId);
        if (accused == msg.sender) revert SelfReport();
        if (evidenceHash == bytes32(0)) revert BadParams();
        bondToken.safeTransferFrom(msg.sender, address(this), reportBond);
        _reports.push(
            Report({
                agentId: agentId,
                reporter: msg.sender,
                accused: accused,
                category: category,
                evidenceHash: evidenceHash,
                evidenceCid: evidenceCid,
                filedAt: uint64(block.timestamp),
                status: ReportStatus.Open,
                slashed: 0
            })
        );
        reportId = _reports.length;
        openReports[agentId]++;
        emit ReportFiled(reportId, agentId, msg.sender, category, evidenceHash, evidenceCid);
    }

    /// @notice The accused human contests within the window by matching the report bond; the arbiter decides.
    function contest(uint256 reportId) external nonReentrant {
        Report storage r = _report(reportId);
        if (r.status != ReportStatus.Open) revert WrongStatus();
        if (msg.sender != r.accused) revert NotHumanOf(r.agentId);
        if (block.timestamp > r.filedAt + contestWindow) revert WindowClosed();
        bondToken.safeTransferFrom(msg.sender, address(this), reportBond);
        r.status = ReportStatus.Contested;
        emit ReportContested(reportId, msg.sender);
    }

    /// @notice After the window, an uncontested report is upheld. Anyone can call this.
    function finalize(uint256 reportId) external nonReentrant {
        Report storage r = _report(reportId);
        if (r.status != ReportStatus.Open) revert WrongStatus();
        if (block.timestamp <= r.filedAt + contestWindow) revert WindowOpen();
        _uphold(reportId, r, false);
    }

    /// @notice The arbiter decides a contested report. The loser's bond goes to the winner.
    function resolve(uint256 reportId, bool upheld) external nonReentrant {
        if (msg.sender != arbiter) revert OnlyArbiter();
        Report storage r = _report(reportId);
        if (r.status != ReportStatus.Contested) revert WrongStatus();
        if (upheld) {
            _uphold(reportId, r, true);
        } else {
            r.status = ReportStatus.Dismissed;
            openReports[r.agentId]--;
            _records[r.agentId].reportsDismissed++;
            falseReports[r.reporter]++;
            // the accused gets their contest bond back plus the reporter's bond
            bondToken.safeTransfer(r.accused, 2 * reportBond);
            emit ReportDismissed(reportId, r.agentId);
        }
    }

    function _uphold(uint256 reportId, Report storage r, bool contested) private {
        r.status = ReportStatus.Upheld;
        uint256 agentId = r.agentId;
        openReports[agentId]--;
        uint256 slashed = (bondOf[agentId] * slashBps) / 10_000;
        bondOf[agentId] -= slashed;
        r.slashed = slashed;
        uint32 upheld = ++_records[agentId].reportsUpheld;
        bool ban = upheld >= banAfter;
        if (ban) registry.ban(agentId);
        // the reporter gets their bond back, the slash, and the accused's contest bond if they lost a contest
        bondToken.safeTransfer(r.reporter, reportBond + slashed + (contested ? reportBond : 0));
        emit ReportUpheld(reportId, agentId, slashed, ban);
    }

    // ------------------------------------------------------------------ agent-to-agent messages

    /// @notice EIP-712 digest of an agent-to-agent message, for the sending agent's key to sign.
    function messageDigest(uint256 fromAgent, uint256 toAgent, bytes32 bodyHash, uint256 nonce, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(AGENT_MESSAGE_TYPEHASH, fromAgent, toAgent, bodyHash, nonce, deadline)));
    }

    /// @notice Should the receiving side trust that this message comes from a live, bonded, accountable
    ///         agent? Checks the signature against the sender's registered key, both agents' status, the
    ///         sender's permission and bond, and the deadline. Returns a code saying why not.
    function verifyMessage(
        uint256 fromAgent,
        uint256 toAgent,
        bytes32 bodyHash,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external view returns (bool ok, bytes32 code) {
        if (block.timestamp > deadline) return (false, "EXPIRED");
        (ok, code) = registry.status(fromAgent);
        if (!ok) return (false, code);
        (ok, code) = registry.status(toAgent);
        if (!ok) return (false, "RECIPIENT_INACTIVE");
        if (!registry.hasPermission(fromAgent, PERM_MESSAGE)) return (false, "NOT_PERMITTED");
        if (!isBonded(fromAgent)) return (false, "NOT_BONDED");
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(messageDigest(fromAgent, toAgent, bodyHash, nonce, deadline), signature);
        if (err != ECDSA.RecoverError.NoError || signer != registry.agent(fromAgent).key) return (false, "BAD_SIGNATURE");
        return (true, bytes32(0));
    }

    // ------------------------------------------------------------------ agent-to-agent deals

    /// @notice The paying agent's human escrows `amount` for a deal with another human's agent. Counts against
    ///         the paying agent's limits and its human's quota (this contract must be an authorised spender, and
    ///         the payee agent delegated as payee `bytes32(toAgent)` unless the paying agent may pay anyone).
    function openDeal(uint256 fromAgent, uint256 toAgent, address token, uint256 amount, bytes32 termsHash, uint64 deadline)
        external
        nonReentrant
        returns (uint256 dealId)
    {
        address payer = registry.humanOf(fromAgent);
        address payee = registry.humanOf(toAgent);
        if (payer != msg.sender) revert NotHumanOf(fromAgent);
        if (payer == payee) revert SameHuman();
        if (deadline <= block.timestamp) revert DeadlinePassed();
        (bool ok, bytes32 code) = registry.status(toAgent);
        if (!ok) revert AgentNotActive(toAgent, code);
        if (!registry.hasPermission(fromAgent, PERM_DEAL)) revert NotPermitted(fromAgent);
        if (!isBonded(fromAgent)) revert NotBonded(fromAgent);
        if (!isBonded(toAgent)) revert NotBonded(toAgent);
        registry.consume(fromAgent, bytes32(toAgent), token, amount); // status, limits and quota
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _deals.push(
            Deal({
                fromAgent: fromAgent,
                toAgent: toAgent,
                payer: payer,
                payee: payee,
                token: token,
                amount: amount,
                termsHash: termsHash,
                deadline: deadline,
                status: DealStatus.Open
            })
        );
        dealId = _deals.length;
        emit DealOpened(dealId, fromAgent, toAgent, token, amount, termsHash, deadline);
    }

    /// @notice The payer confirms delivery: funds go to the payee agent's human; both agents gain a completed deal.
    function confirmDeal(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Open) revert WrongStatus();
        if (msg.sender != d.payer) revert NotHumanOf(d.fromAgent);
        d.status = DealStatus.Completed;
        _credit(d.fromAgent, d.amount);
        _credit(d.toAgent, d.amount);
        IERC20(d.token).safeTransfer(d.payee, d.amount);
        emit DealCompleted(dealId);
    }

    /// @notice The payee side backs out: the payer is refunded.
    function cancelDeal(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Open) revert WrongStatus();
        if (msg.sender != d.payee) revert NotHumanOf(d.toAgent);
        d.status = DealStatus.Cancelled;
        IERC20(d.token).safeTransfer(d.payer, d.amount);
        emit DealCancelled(dealId);
    }

    /// @notice After the deadline, an unconfirmed deal can be reclaimed by the payer. (A payee who delivered
    ///         and was not paid files a report.)
    function reclaim(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Open) revert WrongStatus();
        if (msg.sender != d.payer) revert NotHumanOf(d.fromAgent);
        if (block.timestamp <= d.deadline) revert DeadlineNotPassed();
        d.status = DealStatus.Reclaimed;
        IERC20(d.token).safeTransfer(d.payer, d.amount);
        emit DealReclaimed(dealId);
    }

    function _credit(uint256 agentId, uint256 amount) private {
        Record storage rec = _records[agentId];
        rec.dealsCompleted++;
        uint256 v = uint256(rec.volume) + amount;
        rec.volume = v > type(uint128).max ? type(uint128).max : uint128(v);
    }

    // ------------------------------------------------------------------ reputation

    /// @notice 0..1000. Starts at 500; +10 per completed deal (up to +300); +20 per whole `minBond` bonded
    ///         (up to +100); -150 per upheld report; 0 if banned, revoked or its human is no longer bound.
    function reputation(uint256 agentId) external view returns (uint256 score) {
        (bool ok,) = registry.status(agentId);
        if (!ok) return 0;
        Record memory r = _records[agentId];
        uint256 up = 500 + _min(uint256(r.dealsCompleted) * 10, 300) + _min((bondOf[agentId] / minBond) * 20, 100);
        uint256 down = uint256(r.reportsUpheld) * 150;
        score = up > down ? up - down : 0;
        if (score > 1000) score = 1000;
    }

    function record(uint256 agentId) external view returns (Record memory) {
        return _records[agentId];
    }

    function report(uint256 reportId) external view returns (Report memory) {
        return _report(reportId);
    }

    function deal(uint256 dealId) external view returns (Deal memory) {
        return _deal(dealId);
    }

    function reportCount() external view returns (uint256) {
        return _reports.length;
    }

    function dealCount() external view returns (uint256) {
        return _deals.length;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _report(uint256 id) private view returns (Report storage) {
        if (id == 0 || id > _reports.length) revert UnknownReport(id);
        return _reports[id - 1];
    }

    function _deal(uint256 id) private view returns (Deal storage) {
        if (id == 0 || id > _deals.length) revert UnknownDeal(id);
        return _deals[id - 1];
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
