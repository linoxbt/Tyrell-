// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {IQieId} from "./interfaces/IQieId.sol";

/// @title AgentRegistry
/// @notice Phase A of the agents network: N agents, 1 human, 1 shared quota.
///
///         Every agent is bound to a human, and every human is bound to a QIE ID. The binding is
///         verified against the QIE ID record store when it is made AND every time an agent is used:
///         if the name expires, lapses or moves to another address, all of that human's agents stop.
///
///         Per agent: a key, a label, a metadata hash (model, operator), permissions, a per-payment
///         limit, a daily limit and an optional payee allowlist. Per human: a daily quota per token
///         shared by all their agents, a freeze switch, and the spenders (vaults, escrow) allowed to
///         charge their agents. Revocation is per agent and permanent; a key is never reused.
/// @dev "Today" is block.timestamp / 1 days (UTC), the same boundary GuardedVault and the policy
///      engine use. A token with no quota set cannot be spent by any agent (fail closed).
contract AgentRegistry is IAgentRegistry {
    uint32 public constant PERM_PAY = 1; // propose payments to the human's payees
    uint32 public constant PERM_MEMORY = 2; // write memories on the human's behalf
    uint32 public constant PERM_MESSAGE = 4; // send signed agent-to-agent messages
    uint32 public constant PERM_DEAL = 8; // be the paying side of an agent-to-agent deal
    uint32 public constant MAX_AGENTS = 64;
    string public constant QIE_RECORD = "qie";

    IQieId public immutable qieIdStore;
    address public immutable deployer;
    address public network;

    mapping(address human => Human) private _humans;
    mapping(bytes32 qieIdHash => address human) public humanOfQieId;
    mapping(address human => uint256[]) private _agentsOf;
    mapping(address human => mapping(address token => uint256)) public quota;
    mapping(address human => mapping(address spender => bool)) public isSpender;
    mapping(address human => mapping(address token => mapping(uint256 day => uint256))) private _humanSpent;

    Agent[] private _agents; // id = index + 1
    mapping(address key => uint256 agentId) private _agentOfKey;
    mapping(address key => bool) public keyUsed;
    mapping(uint256 agentId => bool) public banned;
    mapping(uint256 agentId => mapping(bytes32 payeeId => bool)) public payeeAllowed;
    mapping(uint256 agentId => mapping(address token => mapping(uint256 day => uint256))) private _agentSpent;

    constructor(IQieId qieIdStore_) {
        qieIdStore = qieIdStore_;
        deployer = msg.sender;
    }

    // ------------------------------------------------------------------ humans

    /// @notice Bind the caller to a QIE ID they hold. The record store must resolve `qieId` to msg.sender.
    ///         A human holds one QIE ID; binding a new one replaces the old. The record store is the
    ///         authority: if a name moved to a new holder, the new holder's binding replaces the old
    ///         one (which had already stopped resolving, so its agents had already stopped).
    function bindQieId(string calldata qieId) external {
        if (_resolve(qieId) != msg.sender) revert QieIdNotOwned(qieId);
        bytes32 h = keccak256(bytes(qieId));
        address prev = humanOfQieId[h];
        Human storage hu = _humans[msg.sender];
        if (bytes(hu.qieId).length != 0) delete humanOfQieId[keccak256(bytes(hu.qieId))];
        if (prev != address(0) && prev != msg.sender) delete _humans[prev].qieId;
        hu.qieId = qieId;
        hu.boundAt = uint64(block.timestamp);
        humanOfQieId[h] = msg.sender;
        emit HumanBound(msg.sender, qieId, h);
    }

    /// @notice True only while the human's QIE ID still resolves to them (checked live).
    function isBound(address h) public view returns (bool) {
        return bytes(_humans[h].qieId).length != 0 && _resolveStored(h) == h;
    }

    /// @notice Stop (or restart) every agent of the caller at once.
    function freeze(bool frozen) external {
        _humans[msg.sender].frozen = frozen;
        emit HumanFrozen(msg.sender, frozen);
    }

    /// @notice The most all of the caller's agents together may spend in `token` per UTC day.
    function setQuota(address token, uint256 dailyQuota) external {
        quota[msg.sender][token] = dailyQuota;
        emit QuotaSet(msg.sender, token, dailyQuota);
    }

    /// @notice Allow a contract (the caller's GuardedVault, the agents network escrow) to charge the
    ///         caller's agents against their limits and the caller's quota.
    function setSpender(address spender, bool allowed) external {
        isSpender[msg.sender][spender] = allowed;
        emit SpenderSet(msg.sender, spender, allowed);
    }

    // ------------------------------------------------------------------ agents

    /// @notice Register an agent under the caller, who must be bound to a QIE ID. Returns the agent id.
    function registerAgent(
        address key,
        string calldata label,
        bytes32 metaHash,
        uint32 permissions,
        uint128 perTxLimit,
        uint128 dailyLimit,
        bool anyPayee
    ) external returns (uint256 agentId) {
        if (!isBound(msg.sender)) revert NotBound(msg.sender);
        if (key == address(0) || key == msg.sender || keyUsed[key] || bytes(_humans[key].qieId).length != 0) revert BadKey(key);
        Human storage hu = _humans[msg.sender];
        if (hu.agentCount >= MAX_AGENTS) revert TooManyAgents();
        _agents.push(
            Agent({
                key: key,
                human: msg.sender,
                label: label,
                metaHash: metaHash,
                permissions: permissions,
                perTxLimit: perTxLimit,
                dailyLimit: dailyLimit,
                createdAt: uint64(block.timestamp),
                revokedAt: 0,
                revoked: false,
                anyPayee: anyPayee
            })
        );
        agentId = _agents.length;
        keyUsed[key] = true;
        _agentOfKey[key] = agentId;
        _agentsOf[msg.sender].push(agentId);
        hu.agentCount++;
        emit AgentRegistered(agentId, msg.sender, key, label, metaHash);
        emit AgentPermissionsSet(agentId, permissions);
        emit AgentLimitsSet(agentId, perTxLimit, dailyLimit);
        if (anyPayee) emit AgentAnyPayeeSet(agentId, true);
    }

    function setPermissions(uint256 agentId, uint32 permissions) external {
        _own(agentId).permissions = permissions;
        emit AgentPermissionsSet(agentId, permissions);
    }

    function setLimits(uint256 agentId, uint128 perTxLimit, uint128 dailyLimit) external {
        Agent storage a = _own(agentId);
        a.perTxLimit = perTxLimit;
        a.dailyLimit = dailyLimit;
        emit AgentLimitsSet(agentId, perTxLimit, dailyLimit);
    }

    /// @notice Delegate (or withdraw) specific payees to an agent. Payees are TyrellLedger payee ids;
    ///         for agent-to-agent deals the payee id of agent N is bytes32(N).
    function setPayees(uint256 agentId, bytes32[] calldata payeeIds, bool allowed) external {
        _own(agentId);
        for (uint256 i; i < payeeIds.length; ++i) {
            payeeAllowed[agentId][payeeIds[i]] = allowed;
            emit AgentPayeeSet(agentId, payeeIds[i], allowed);
        }
    }

    function setAnyPayee(uint256 agentId, bool anyPayee) external {
        _own(agentId).anyPayee = anyPayee;
        emit AgentAnyPayeeSet(agentId, anyPayee);
    }

    /// @notice Revoke one agent for good. Its key can never be registered again.
    function revokeAgent(uint256 agentId, string calldata reason) external {
        Agent storage a = _own(agentId);
        a.revoked = true;
        a.revokedAt = uint64(block.timestamp);
        delete _agentOfKey[a.key];
        _humans[msg.sender].agentCount--;
        emit AgentRevoked(agentId, a.key, reason);
    }

    // ------------------------------------------------------------------ spending

    /// @notice Is `agentId` allowed to act at all right now? Codes say why not.
    function status(uint256 agentId) public view returns (bool ok, bytes32 code) {
        if (agentId == 0 || agentId > _agents.length) return (false, "UNKNOWN_AGENT");
        Agent storage a = _agents[agentId - 1];
        if (a.revoked) return (false, "AGENT_REVOKED");
        if (banned[agentId]) return (false, "AGENT_BANNED");
        if (!isBound(a.human)) return (false, "HUMAN_UNBOUND");
        if (_humans[a.human].frozen) return (false, "HUMAN_FROZEN");
        return (true, bytes32(0));
    }

    function hasPermission(uint256 agentId, uint32 permission) public view returns (bool) {
        return agentId != 0 && agentId <= _agents.length && _agents[agentId - 1].permissions & permission == permission;
    }

    /// @notice Would charging `amount` of `token` to `agentId` for `payeeId` pass, today?
    function check(uint256 agentId, bytes32 payeeId, address token, uint256 amount) public view returns (bool ok, bytes32 code) {
        (ok, code) = status(agentId);
        if (!ok) return (ok, code);
        Agent storage a = _agents[agentId - 1];
        if (a.permissions & PERM_PAY == 0) return (false, "NOT_PERMITTED");
        if (!a.anyPayee && !payeeAllowed[agentId][payeeId]) return (false, "PAYEE_NOT_DELEGATED");
        if (amount == 0 || amount > a.perTxLimit) return (false, "OVER_AGENT_TX_LIMIT");
        uint256 day = block.timestamp / 1 days;
        if (_agentSpent[agentId][token][day] + amount > a.dailyLimit) return (false, "OVER_AGENT_DAILY_LIMIT");
        if (_humanSpent[a.human][token][day] + amount > quota[a.human][token]) return (false, "OVER_HUMAN_QUOTA");
        return (true, bytes32(0));
    }

    /// @notice Charge a spend to an agent and its human's shared quota. Only spenders the agent's
    ///         human authorised (their GuardedVault, the network escrow) can call this.
    function consume(uint256 agentId, bytes32 payeeId, address token, uint256 amount) external {
        address h = humanOf(agentId);
        if (!isSpender[h][msg.sender]) revert NotSpender(msg.sender);
        (bool ok, bytes32 code) = check(agentId, payeeId, token, amount);
        if (!ok) revert AgentBlocked(code);
        uint256 day = block.timestamp / 1 days;
        _agentSpent[agentId][token][day] += amount;
        _humanSpent[h][token][day] += amount;
        emit AgentSpent(agentId, h, payeeId, token, amount, msg.sender);
    }

    // ------------------------------------------------------------------ network (phase B)

    /// @notice Link the agents network (bonds, reports, penalties) once. Deployer only.
    function setNetwork(address network_) external {
        if (msg.sender != deployer) revert OnlyNetwork();
        if (network != address(0)) revert NetworkAlreadySet();
        network = network_;
        emit NetworkSet(network_);
    }

    /// @notice The network bans an agent after repeated upheld reports. Permanent.
    function ban(uint256 agentId) external {
        if (msg.sender != network || network == address(0)) revert OnlyNetwork();
        if (agentId == 0 || agentId > _agents.length) revert UnknownAgent(agentId);
        banned[agentId] = true;
        emit AgentBanned(agentId);
    }

    // ------------------------------------------------------------------ views

    function human(address h) external view returns (Human memory) {
        return _humans[h];
    }

    function agentsOf(address h) external view returns (uint256[] memory) {
        return _agentsOf[h];
    }

    function agentCount() external view returns (uint256) {
        return _agents.length;
    }

    function agent(uint256 agentId) public view returns (Agent memory) {
        if (agentId == 0 || agentId > _agents.length) revert UnknownAgent(agentId);
        return _agents[agentId - 1];
    }

    function humanOf(uint256 agentId) public view returns (address) {
        if (agentId == 0 || agentId > _agents.length) revert UnknownAgent(agentId);
        return _agents[agentId - 1].human;
    }

    /// @notice The active agent id for a key, 0 if unknown or revoked.
    function agentIdOf(address key) external view returns (uint256) {
        return _agentOfKey[key];
    }

    function spentToday(uint256 agentId, address token) external view returns (uint256) {
        return _agentSpent[agentId][token][block.timestamp / 1 days];
    }

    function humanSpentToday(address h, address token) external view returns (uint256) {
        return _humanSpent[h][token][block.timestamp / 1 days];
    }

    // ------------------------------------------------------------------ internal

    function _own(uint256 agentId) private view returns (Agent storage a) {
        if (agentId == 0 || agentId > _agents.length) revert UnknownAgent(agentId);
        a = _agents[agentId - 1];
        if (a.human != msg.sender) revert NotYourAgent(agentId);
        if (a.revoked) revert AgentIsRevoked(agentId);
    }

    function _resolveStored(address h) private view returns (address) {
        return _resolve(_humans[h].qieId);
    }

    /// @dev Expired free names make the record store revert; treat that as "resolves to nobody".
    function _resolve(string memory qieId) private view returns (address) {
        if (bytes(qieId).length == 0) return address(0);
        try qieIdStore.resolveCurrency(qieId, QIE_RECORD) returns (address a) {
            return a;
        } catch {
            return address(0);
        }
    }
}
