// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @title AgentNetwork
/// @notice Phase B of the agents network: what lets agents of different humans deal with each other.
///
///         Bonds      every agent that wants to message or deal posts a bond (at least `minBond`). Leaving
///                    takes two steps: request, then withdraw one `contestWindow` later, never while a report
///                    is open. The bond can still be slashed while a withdrawal waits.
///         Reports    a QIE-ID-bound human reports another human's agent, with evidence and a report bond. A
///                    reporter has at most `MAX_OPEN_PER_REPORTER` open reports, one per agent, and waits one
///                    `contestWindow` before reporting the same agent again.
///         Disputes   the accused human may contest within `contestWindow` by matching the bond. A report
///                    nobody contests closes as "uncontested": the reporter gets only their own bond back,
///                    nothing is slashed, and it counts against the agent's reputation but never bans it.
///                    A contested report goes to the `arbiter`, who must rule within `ruleWindow`; if they do
///                    not, both bonds are refunded and nothing happens. The arbiter never rules on a report
///                    they filed or one against their own agent.
///         Penalties  only the arbiter's ruling slashes (`slashBps` of the bond, to the reporter, with the
///                    accused's contest bond) or bans (at `banAfter` upheld rulings). A dismissed report sends
///                    the reporter's bond to the accused. A banned agent's human may appeal; the arbiter can
///                    lift the ban. The owner (a council) can replace the arbiter.
///         Reputation a 0..1000 score from on-chain history: completed deals, rulings, uncontested reports, bond.
///         A2A        agents sign EIP-712 messages to each other. The recipient records a message it acts on
///                    (`acceptMessage`), so the same signed message can't be replayed.
///         Deals      escrowed payments between agents that count against the paying agent's limits and its
///                    human's quota (refunded if the deal is cancelled or reclaimed). The payee may mark a deal
///                    delivered before the deadline: the payer then confirms, or disputes within
///                    `contestWindow` (the arbiter decides; if they do not, the payer is refunded), and if the
///                    payer does neither the payee claims the funds.
///
///         Money only moves on a human's call (or the arbiter's ruling): agents sign messages, humans fund,
///         deliver, confirm and contest.
contract AgentNetwork is EIP712, ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    enum ReportStatus {
        None,
        Open,
        Contested,
        Upheld, // by the arbiter
        Dismissed, // by the arbiter
        Uncontested, // the window closed without a contest
        Lapsed // contested, and the arbiter did not rule in time
    }

    enum DealStatus {
        None,
        Open,
        Completed,
        Cancelled,
        Reclaimed,
        Delivered,
        Disputed,
        Refunded
    }

    struct Params {
        address arbiter;
        uint256 minBond;
        uint256 reportBond;
        uint64 contestWindow;
        uint64 ruleWindow;
        uint16 slashBps;
        uint8 banAfter;
    }

    struct Report {
        uint256 agentId;
        address reporter;
        address accused; // the agent's human when filed
        uint8 category;
        bytes32 evidenceHash;
        string evidenceCid;
        uint64 filedAt;
        uint64 contestedAt;
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
        uint64 openedDay; // the UTC day the quota was charged (refunded on cancel or reclaim)
        uint64 deliveredAt;
        uint64 disputedAt;
        DealStatus status;
    }

    struct Record {
        uint32 dealsCompleted;
        uint32 reportsUpheld;
        uint32 reportsDismissed;
        uint32 reportsUncontested;
        uint128 volume;
    }

    struct Withdrawal {
        uint256 amount;
        uint64 readyAt;
    }

    bytes32 public constant AGENT_MESSAGE_TYPEHASH =
        keccak256("AgentMessage(uint256 fromAgent,uint256 toAgent,bytes32 bodyHash,uint256 nonce,uint64 deadline)");
    uint32 private constant PERM_MESSAGE = 4;
    uint32 private constant PERM_DEAL = 8;
    uint256 public constant MAX_OPEN_PER_REPORTER = 5;

    IAgentRegistry public immutable registry;
    IERC20 public immutable bondToken;
    uint256 public immutable minBond;
    uint256 public immutable reportBond;
    uint64 public immutable contestWindow;
    uint64 public immutable ruleWindow;
    uint16 public immutable slashBps;
    uint8 public immutable banAfter;
    address public arbiter;

    mapping(uint256 agentId => uint256) public bondOf;
    mapping(uint256 agentId => Withdrawal) public pendingWithdrawal;
    mapping(uint256 agentId => uint256) public openReports;
    mapping(uint256 agentId => Record) private _records;
    mapping(address human => uint32) public falseReports;
    mapping(address reporter => uint256) public openReportsBy;
    mapping(address reporter => mapping(uint256 agentId => uint64)) public lastReportClosed;
    mapping(address reporter => mapping(uint256 agentId => bool)) public hasOpenReport;
    mapping(uint256 fromAgent => mapping(uint256 nonce => bool)) public messageUsed;
    Report[] private _reports; // id = index + 1
    Deal[] private _deals; // id = index + 1

    event Bonded(uint256 indexed agentId, address indexed from, uint256 amount, uint256 total);
    event WithdrawalRequested(uint256 indexed agentId, uint256 amount, uint64 readyAt);
    event WithdrawalCancelled(uint256 indexed agentId);
    event BondWithdrawn(uint256 indexed agentId, address indexed to, uint256 amount, uint256 total);
    event ReportFiled(uint256 indexed reportId, uint256 indexed agentId, address indexed reporter, uint8 category, bytes32 evidenceHash, string evidenceCid);
    event ReportContested(uint256 indexed reportId, address indexed accused);
    event ReportUpheld(uint256 indexed reportId, uint256 indexed agentId, uint256 slashed, bool banned);
    event ReportDismissed(uint256 indexed reportId, uint256 indexed agentId);
    event ReportUncontested(uint256 indexed reportId, uint256 indexed agentId);
    event ReportLapsed(uint256 indexed reportId, uint256 indexed agentId);
    event BanAppealed(uint256 indexed agentId, address indexed human, string evidenceCid);
    event BanLifted(uint256 indexed agentId, string reason);
    event ArbiterChanged(address indexed previous, address indexed current);
    event MessageAccepted(uint256 indexed fromAgent, uint256 indexed toAgent, uint256 nonce, bytes32 bodyHash);
    event DealOpened(uint256 indexed dealId, uint256 indexed fromAgent, uint256 indexed toAgent, address token, uint256 amount, bytes32 termsHash, uint64 deadline);
    event DealDelivered(uint256 indexed dealId);
    event DealDisputed(uint256 indexed dealId);
    event DealCompleted(uint256 indexed dealId);
    event DealCancelled(uint256 indexed dealId);
    event DealReclaimed(uint256 indexed dealId);
    event DealRefunded(uint256 indexed dealId);

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
    error ArbiterConflict();
    error SameHuman();
    error NotBonded(uint256 agentId);
    error DeadlinePassed();
    error DeadlineNotPassed();
    error BadParams();
    error TooManyOpenReports();
    error AlreadyReported();
    error ReportCooldown();
    error NoWithdrawal();
    error WithdrawalNotReady();
    error NotBanned();
    error MessageRejected(bytes32 code);
    error NoRenounce();

    constructor(IAgentRegistry registry_, IERC20 bondToken_, address owner_, Params memory p)
        EIP712("TyrellAgentNetwork", "1")
        Ownable(owner_)
    {
        if (
            address(registry_) == address(0) || address(bondToken_) == address(0) || p.arbiter == address(0) || p.minBond == 0
                || p.reportBond == 0 || p.contestWindow == 0 || p.ruleWindow == 0 || p.slashBps == 0 || p.slashBps > 10_000
                || p.banAfter == 0
        ) revert BadParams();
        registry = registry_;
        bondToken = bondToken_;
        arbiter = p.arbiter;
        minBond = p.minBond;
        reportBond = p.reportBond;
        contestWindow = p.contestWindow;
        ruleWindow = p.ruleWindow;
        slashBps = p.slashBps;
        banAfter = p.banAfter;
        emit ArbiterChanged(address(0), p.arbiter);
    }

    // ------------------------------------------------------------------ owner (council)

    /// @notice Replace the arbiter (a lost, idle or compromised arbiter). Owner only.
    function setArbiter(address arbiter_) external onlyOwner {
        if (arbiter_ == address(0)) revert BadParams();
        emit ArbiterChanged(arbiter, arbiter_);
        arbiter = arbiter_;
    }

    /// @notice The network always has an owner who can replace the arbiter. Hand over with transferOwnership.
    function renounceOwnership() public pure override {
        revert NoRenounce();
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

    /// @notice Step 1 of leaving: ask to withdraw `amount`. It becomes available one `contestWindow` later.
    ///         An active agent must keep at least `minBond` (or withdraw everything and leave the network).
    ///         The pending amount no longer counts towards `isBonded` or reputation, but can still be slashed.
    function requestWithdrawal(uint256 agentId, uint256 amount) external {
        if (registry.humanOf(agentId) != msg.sender) revert NotHumanOf(agentId);
        uint256 b = bondOf[agentId];
        if (amount == 0 || amount > b) revert BadAmount();
        uint256 left = b - amount;
        if (left != 0 && left < minBond) revert BelowMinBond(agentId);
        uint64 readyAt = uint64(block.timestamp) + contestWindow;
        pendingWithdrawal[agentId] = Withdrawal({amount: amount, readyAt: readyAt});
        emit WithdrawalRequested(agentId, amount, readyAt);
    }

    function cancelWithdrawal(uint256 agentId) external {
        if (registry.humanOf(agentId) != msg.sender) revert NotHumanOf(agentId);
        if (pendingWithdrawal[agentId].amount == 0) revert NoWithdrawal();
        delete pendingWithdrawal[agentId];
        emit WithdrawalCancelled(agentId);
    }

    /// @notice Step 2: take the requested amount (less anything slashed meanwhile). Never with open reports.
    function withdrawBond(uint256 agentId) external nonReentrant {
        if (registry.humanOf(agentId) != msg.sender) revert NotHumanOf(agentId);
        Withdrawal memory w = pendingWithdrawal[agentId];
        if (w.amount == 0) revert NoWithdrawal();
        if (block.timestamp < w.readyAt) revert WithdrawalNotReady();
        if (openReports[agentId] != 0) revert OpenReports(agentId);
        uint256 b = bondOf[agentId];
        uint256 amount = w.amount < b ? w.amount : b;
        delete pendingWithdrawal[agentId];
        bondOf[agentId] = b - amount;
        bondToken.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(agentId, msg.sender, amount, b - amount);
    }

    /// @notice The bond that counts: everything posted, less any withdrawal waiting to leave.
    function effectiveBond(uint256 agentId) public view returns (uint256) {
        uint256 b = bondOf[agentId];
        uint256 p = pendingWithdrawal[agentId].amount;
        return p < b ? b - p : 0;
    }

    function isBonded(uint256 agentId) public view returns (bool) {
        return effectiveBond(agentId) >= minBond;
    }

    // ------------------------------------------------------------------ reports and disputes

    /// @notice Report an agent. The reporter must be a human bound to a QIE ID (accountable), may not report
    ///         their own agent, posts `reportBond`, and is limited (see the contract notes). Agents with no
    ///         bond can be reported too: there is nothing to slash, but rulings still count and can ban.
    function fileReport(uint256 agentId, uint8 category, bytes32 evidenceHash, string calldata evidenceCid)
        external
        nonReentrant
        returns (uint256 reportId)
    {
        if (!registry.isBound(msg.sender)) revert NotBound(msg.sender);
        address accused = registry.humanOf(agentId);
        if (accused == msg.sender) revert SelfReport();
        if (evidenceHash == bytes32(0)) revert BadParams();
        if (hasOpenReport[msg.sender][agentId]) revert AlreadyReported();
        if (openReportsBy[msg.sender] >= MAX_OPEN_PER_REPORTER) revert TooManyOpenReports();
        uint64 last = lastReportClosed[msg.sender][agentId];
        if (last != 0 && block.timestamp < last + contestWindow) revert ReportCooldown();
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
                contestedAt: 0,
                status: ReportStatus.Open,
                slashed: 0
            })
        );
        reportId = _reports.length;
        openReports[agentId]++;
        openReportsBy[msg.sender]++;
        hasOpenReport[msg.sender][agentId] = true;
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
        r.contestedAt = uint64(block.timestamp);
        emit ReportContested(reportId, msg.sender);
    }

    /// @notice After the window, close a report nobody contested. Anyone can call this. The reporter gets
    ///         their own bond back and nothing more; the agent's record counts one uncontested report.
    function finalize(uint256 reportId) external nonReentrant {
        Report storage r = _report(reportId);
        if (r.status != ReportStatus.Open) revert WrongStatus();
        if (block.timestamp <= r.filedAt + contestWindow) revert WindowOpen();
        r.status = ReportStatus.Uncontested;
        _close(r);
        _records[r.agentId].reportsUncontested++;
        bondToken.safeTransfer(r.reporter, reportBond);
        emit ReportUncontested(reportId, r.agentId);
    }

    /// @notice The arbiter decides a contested report within `ruleWindow`. The loser's bond goes to the winner;
    ///         an upheld report also slashes the agent's bond to the reporter and may ban the agent.
    function resolve(uint256 reportId, bool upheld) external nonReentrant {
        Report storage r = _report(reportId);
        if (msg.sender != arbiter) revert OnlyArbiter();
        if (r.status != ReportStatus.Contested) revert WrongStatus();
        if (block.timestamp > r.contestedAt + ruleWindow) revert WindowClosed();
        if (msg.sender == r.reporter || msg.sender == r.accused || msg.sender == registry.humanOf(r.agentId)) revert ArbiterConflict();
        uint256 agentId = r.agentId;
        _close(r);
        if (upheld) {
            r.status = ReportStatus.Upheld;
            uint256 slashed = (bondOf[agentId] * slashBps) / 10_000;
            bondOf[agentId] -= slashed;
            r.slashed = slashed;
            bool ban = ++_records[agentId].reportsUpheld >= banAfter;
            if (ban) registry.ban(agentId);
            // the reporter: their bond back, the accused's contest bond and the slash
            bondToken.safeTransfer(r.reporter, 2 * reportBond + slashed);
            emit ReportUpheld(reportId, agentId, slashed, ban);
        } else {
            r.status = ReportStatus.Dismissed;
            _records[agentId].reportsDismissed++;
            falseReports[r.reporter]++;
            // the accused gets their contest bond back plus the reporter's bond
            bondToken.safeTransfer(r.accused, 2 * reportBond);
            emit ReportDismissed(reportId, agentId);
        }
    }

    /// @notice A contested report the arbiter did not rule on in time closes with no outcome: both bonds are
    ///         refunded and nothing is slashed. Anyone can call this.
    function lapse(uint256 reportId) external nonReentrant {
        Report storage r = _report(reportId);
        if (r.status != ReportStatus.Contested) revert WrongStatus();
        if (block.timestamp <= r.contestedAt + ruleWindow) revert WindowOpen();
        r.status = ReportStatus.Lapsed;
        _close(r);
        bondToken.safeTransfer(r.reporter, reportBond);
        bondToken.safeTransfer(r.accused, reportBond);
        emit ReportLapsed(reportId, r.agentId);
    }

    /// @notice A banned agent's human asks the arbiter to lift the ban, with evidence.
    function appeal(uint256 agentId, string calldata evidenceCid) external {
        if (registry.humanOf(agentId) != msg.sender) revert NotHumanOf(agentId);
        if (!_banned(agentId)) revert NotBanned();
        emit BanAppealed(agentId, msg.sender, evidenceCid);
    }

    /// @notice The arbiter lifts a ban (an appeal granted). The agent's upheld rulings are reset.
    function unban(uint256 agentId, string calldata reason) external {
        if (msg.sender != arbiter) revert OnlyArbiter();
        if (!_banned(agentId)) revert NotBanned();
        if (msg.sender == registry.humanOf(agentId)) revert ArbiterConflict();
        _records[agentId].reportsUpheld = 0;
        registry.unban(agentId);
        emit BanLifted(agentId, reason);
    }

    function _banned(uint256 agentId) private view returns (bool) {
        (bool ok, bytes32 code) = registry.status(agentId);
        return !ok && code == "AGENT_BANNED";
    }

    function _close(Report storage r) private {
        openReports[r.agentId]--;
        openReportsBy[r.reporter]--;
        hasOpenReport[r.reporter][r.agentId] = false;
        lastReportClosed[r.reporter][r.agentId] = uint64(block.timestamp);
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
    ///         sender's permission and bond, the deadline, and that the message was not already accepted.
    ///         Returns a code saying why not.
    function verifyMessage(
        uint256 fromAgent,
        uint256 toAgent,
        bytes32 bodyHash,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) public view returns (bool ok, bytes32 code) {
        if (block.timestamp > deadline) return (false, "EXPIRED");
        if (messageUsed[fromAgent][nonce]) return (false, "NONCE_USED");
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

    /// @notice The receiving agent (its key or its human) records that it acts on a message: it must verify,
    ///         and from then on the same (fromAgent, nonce) is refused, so the message can't be replayed.
    function acceptMessage(
        uint256 fromAgent,
        uint256 toAgent,
        bytes32 bodyHash,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external {
        if (msg.sender != registry.humanOf(toAgent) && msg.sender != registry.agent(toAgent).key) revert NotHumanOf(toAgent);
        (bool ok, bytes32 code) = verifyMessage(fromAgent, toAgent, bodyHash, nonce, deadline, signature);
        if (!ok) revert MessageRejected(code);
        messageUsed[fromAgent][nonce] = true;
        emit MessageAccepted(fromAgent, toAgent, nonce, bodyHash);
    }

    // ------------------------------------------------------------------ agent-to-agent deals

    /// @notice The paying agent's human escrows `amount` for a deal with another human's agent. The paying
    ///         agent needs DEAL permission; it counts against its limits and its human's quota (this contract
    ///         must be an authorised spender, and the payee agent delegated as payee `bytes32(toAgent)` unless
    ///         the paying agent may pay anyone).
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
        if (!isBonded(fromAgent)) revert NotBonded(fromAgent);
        if (!isBonded(toAgent)) revert NotBonded(toAgent);
        registry.consumeDeal(fromAgent, bytes32(toAgent), token, amount); // DEAL permission, status, limits, quota
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
                openedDay: uint64(block.timestamp / 1 days),
                deliveredAt: 0,
                disputedAt: 0,
                status: DealStatus.Open
            })
        );
        dealId = _deals.length;
        emit DealOpened(dealId, fromAgent, toAgent, token, amount, termsHash, deadline);
    }

    /// @notice The payee marks the deal delivered, before the deadline. From then on the payer can no longer
    ///         reclaim it: they confirm, or dispute within `contestWindow`; otherwise the payee claims.
    function deliver(uint256 dealId) external {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Open) revert WrongStatus();
        if (msg.sender != d.payee) revert NotHumanOf(d.toAgent);
        if (block.timestamp > d.deadline) revert DeadlinePassed();
        d.status = DealStatus.Delivered;
        d.deliveredAt = uint64(block.timestamp);
        emit DealDelivered(dealId);
    }

    /// @notice The payer confirms delivery: funds go to the payee agent's human; both agents gain a completed deal.
    function confirmDeal(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Open && d.status != DealStatus.Delivered) revert WrongStatus();
        if (msg.sender != d.payer) revert NotHumanOf(d.fromAgent);
        _complete(dealId, d);
    }

    /// @notice A delivered deal the payer neither confirmed nor disputed in time: the payee takes the funds.
    function claim(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Delivered) revert WrongStatus();
        if (msg.sender != d.payee) revert NotHumanOf(d.toAgent);
        if (block.timestamp <= d.deliveredAt + contestWindow) revert WindowOpen();
        _complete(dealId, d);
    }

    /// @notice The payer says a delivered deal was not delivered; the arbiter decides.
    function disputeDeal(uint256 dealId) external {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Delivered) revert WrongStatus();
        if (msg.sender != d.payer) revert NotHumanOf(d.fromAgent);
        if (block.timestamp > d.deliveredAt + contestWindow) revert WindowClosed();
        d.status = DealStatus.Disputed;
        d.disputedAt = uint64(block.timestamp);
        emit DealDisputed(dealId);
    }

    /// @notice The arbiter decides a disputed deal within `ruleWindow`: pay the payee, or refund the payer.
    function resolveDeal(uint256 dealId, bool payPayee) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (msg.sender != arbiter) revert OnlyArbiter();
        if (d.status != DealStatus.Disputed) revert WrongStatus();
        if (block.timestamp > d.disputedAt + ruleWindow) revert WindowClosed();
        if (msg.sender == d.payer || msg.sender == d.payee) revert ArbiterConflict();
        if (payPayee) _complete(dealId, d);
        else _refundPayer(dealId, d, DealStatus.Refunded);
    }

    /// @notice A disputed deal the arbiter did not decide in time: the payer is refunded (the payee may report).
    function lapseDeal(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Disputed) revert WrongStatus();
        if (block.timestamp <= d.disputedAt + ruleWindow) revert WindowOpen();
        _refundPayer(dealId, d, DealStatus.Refunded);
    }

    /// @notice The payee side backs out (before or after marking delivery, or during a dispute): the payer
    ///         is refunded.
    function cancelDeal(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        DealStatus s = d.status;
        if (s != DealStatus.Open && s != DealStatus.Delivered && s != DealStatus.Disputed) revert WrongStatus();
        if (msg.sender != d.payee) revert NotHumanOf(d.toAgent);
        _refundPayer(dealId, d, DealStatus.Cancelled);
    }

    /// @notice After the deadline, a deal the payee never marked delivered can be reclaimed by the payer.
    function reclaim(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Open) revert WrongStatus();
        if (msg.sender != d.payer) revert NotHumanOf(d.fromAgent);
        if (block.timestamp <= d.deadline) revert DeadlineNotPassed();
        _refundPayer(dealId, d, DealStatus.Reclaimed);
    }

    function _complete(uint256 dealId, Deal storage d) private {
        d.status = DealStatus.Completed;
        _credit(d.fromAgent, d.amount);
        _credit(d.toAgent, d.amount);
        IERC20(d.token).safeTransfer(d.payee, d.amount);
        emit DealCompleted(dealId);
    }

    /// @dev Refunds the escrow and gives the paying agent's quota back for the day it was charged.
    function _refundPayer(uint256 dealId, Deal storage d, DealStatus s) private {
        d.status = s;
        registry.refund(d.fromAgent, d.token, d.amount, d.openedDay);
        IERC20(d.token).safeTransfer(d.payer, d.amount);
        if (s == DealStatus.Cancelled) emit DealCancelled(dealId);
        else if (s == DealStatus.Reclaimed) emit DealReclaimed(dealId);
        else emit DealRefunded(dealId);
    }

    function _credit(uint256 agentId, uint256 amount) private {
        Record storage rec = _records[agentId];
        rec.dealsCompleted++;
        uint256 v = uint256(rec.volume) + amount;
        rec.volume = v > type(uint128).max ? type(uint128).max : uint128(v);
    }

    // ------------------------------------------------------------------ reputation

    /// @notice 0..1000. Starts at 500; +10 per completed deal (up to +300); +20 per whole `minBond` of effective
    ///         bond (up to +100); -150 per report upheld by the arbiter; -50 per uncontested report; 0 if
    ///         banned, revoked or its human is no longer bound.
    function reputation(uint256 agentId) public view returns (uint256 score) {
        (bool ok,) = registry.status(agentId);
        if (!ok) return 0;
        Record memory r = _records[agentId];
        uint256 up = 500 + _min(uint256(r.dealsCompleted) * 10, 300) + _min((effectiveBond(agentId) / minBond) * 20, 100);
        uint256 down = uint256(r.reportsUpheld) * 150 + uint256(r.reportsUncontested) * 50;
        score = up > down ? up - down : 0;
        if (score > 1000) score = 1000;
    }

    /// @notice Bonds and reputations of many agents in one call.
    function stats(uint256[] calldata agentIds) external view returns (uint256[] memory bonds, uint256[] memory reps) {
        bonds = new uint256[](agentIds.length);
        reps = new uint256[](agentIds.length);
        for (uint256 i; i < agentIds.length; ++i) {
            bonds[i] = bondOf[agentIds[i]];
            reps[i] = reputation(agentIds[i]);
        }
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
