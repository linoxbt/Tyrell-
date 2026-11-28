// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {IQieId} from "./interfaces/IQieId.sol";

/// @title AgentRegistry
/// @notice Phase A of the agents network: N agents, 1 human, 1 shared quota.
///
///         Every agent is bound to a human, and every human is bound to a QIE ID. The binding is
///         verified against the QIE ID record store when it is made AND every time an agent is used:
///         if the name expires, lapses or moves to another address, all of that human's agents stop.
///
///         Per agent: a key, the one token it spends, a label, a metadata hash (model, operator),
///         permissions, a per-payment limit and a daily limit (both in its token), and an optional payee
///         allowlist. Per human: a daily quota per token shared by all their agents, a freeze switch,
///         and the spenders (vaults, escrow) allowed to charge their agents. Revocation is per agent and
///         permanent; a key is never reused.
///
///         The agent key co-signs its own registration (EIP-712 RegisterAgent), so nobody can claim
///         another deployment's agent key, which is public, before its real human does.
/// @dev "Today" is block.timestamp / 1 days (UTC), the same boundary GuardedVault and the policy
///      engine use. A token with no quota set cannot be spent by any agent (fail closed). An agent's
///      daily limit is one number for the agent (it spends one token), not one per token.
contract AgentRegistry is IAgentRegistry, EIP712 {
    uint32 public constant PERM_PAY = 1; // propose payments to the human's payees
    uint32 public constant PERM_MEMORY = 2; // write memories on the human's behalf
    uint32 public constant PERM_MESSAGE = 4; // send signed agent-to-agent messages
    uint32 public constant PERM_DEAL = 8; // be the paying side of an agent-to-agent deal
    uint32 public constant MAX_AGENTS = 64;
    string public constant QIE_RECORD = "qie";
    bytes32 public constant REGISTER_AGENT_TYPEHASH = keccak256("RegisterAgent(address human,address key,uint64 deadline)");
    bytes32 public constant ROTATE_AGENT_KEY_TYPEHASH = keccak256("RotateAgentKey(uint256 agentId,address human,address key,uint64 deadline)");

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
    mapping(uint256 agentId => mapping(uint256 day => uint256)) private _agentSpent;
    /// @dev What each spender charged each agent on each day: the most it may later refund.
    mapping(uint256 agentId => mapping(uint256 day => mapping(address spender => uint256))) public chargedBy;

    constructor(IQieId qieIdStore_) EIP712("TyrellAgentRegistry", "1") {
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
    ///         `keySig` is the agent key's EIP-712 signature of RegisterAgent(human = caller, key, deadline):
    ///         only the holder of the agent key can consent to being this human's agent.
    function registerAgent(NewAgent calldata n, uint64 deadline, bytes calldata keySig) external returns (uint256 agentId) {
        if (!isBound(msg.sender)) revert NotBound(msg.sender);
        address key = n.key;
        if (n.token == address(0)) revert BadToken();
        _checkNewKey(key, deadline, registrationDigest(msg.sender, key, deadline), keySig);
        Human storage hu = _humans[msg.sender];
        if (hu.agentCount >= MAX_AGENTS) revert TooManyAgents();
        _agents.push(
            Agent({
                key: key,
                human: msg.sender,
                token: n.token,
                label: n.label,
                metaHash: n.metaHash,
                permissions: n.permissions,
                perTxLimit: n.perTxLimit,
                dailyLimit: n.dailyLimit,
                createdAt: uint64(block.timestamp),
                revokedAt: 0,
                revoked: false,
                anyPayee: n.anyPayee
            })
        );
        agentId = _agents.length;
        keyUsed[key] = true;
        _agentOfKey[key] = agentId;
        _agentsOf[msg.sender].push(agentId);
        hu.agentCount++;
        emit AgentRegistered(agentId, msg.sender, key, n.label, n.metaHash);
        emit AgentTokenSet(agentId, n.token);
        emit AgentPermissionsSet(agentId, n.permissions);
        emit AgentLimitsSet(agentId, n.perTxLimit, n.dailyLimit);
        if (n.anyPayee) emit AgentAnyPayeeSet(agentId, true);
    }

    /// @notice Replace an agent's key in place (the lane key was rotated). The NEW key consents with an EIP-712
    ///         RotateAgentKey(agentId, human = caller, key, deadline) signature. The agent keeps its id,
    ///         limits, spend, permissions, ban and reputation; the old key stops working at once and, like
    ///         every key ever used, can never be registered again.
    function rotateAgentKey(uint256 agentId, address newKey, uint64 deadline, bytes calldata keySig) external {
        Agent storage a = _own(agentId);
        _checkNewKey(newKey, deadline, rotationDigest(agentId, msg.sender, newKey, deadline), keySig);
        address old = a.key;
        delete _agentOfKey[old];
        a.key = newKey;
        keyUsed[newKey] = true;
        _agentOfKey[newKey] = agentId;
        emit AgentKeyRotated(agentId, old, newKey);
    }

    /// @notice The EIP-712 digest a new agent key signs to consent to replacing agent `agentId`'s key.
    function rotationDigest(uint256 agentId, address human_, address key, uint64 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ROTATE_AGENT_KEY_TYPEHASH, agentId, human_, key, deadline)));
    }

    /// @dev A key can be an agent key once ever, is never a human, and must sign its own consent in time.
    function _checkNewKey(address key, uint64 deadline, bytes32 digest, bytes calldata keySig) private view {
        if (key == address(0) || key == msg.sender || keyUsed[key] || bytes(_humans[key].qieId).length != 0) revert BadKey(key);
        if (block.timestamp > deadline) revert SignatureExpired();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, keySig);
        if (err != ECDSA.RecoverError.NoError || signer != key) revert BadKeySignature();
    }

    /// @notice The EIP-712 digest an agent key signs to consent to being `human`'s agent.
    function registrationDigest(address human_, address key, uint64 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(REGISTER_AGENT_TYPEHASH, human_, key, deadline)));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
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

    /// @notice Would paying `amount` of `token` to payee `payeeId` from `agentId` pass, today? (PAY)
    function check(uint256 agentId, bytes32 payeeId, address token, uint256 amount) public view returns (bool ok, bytes32 code) {
        return _check(agentId, PERM_PAY, payeeId, token, amount);
    }

    /// @notice The same for the paying side of an agent-to-agent deal (DEAL; the payee is bytes32(toAgent)).
    function checkDeal(uint256 agentId, bytes32 payeeId, address token, uint256 amount) public view returns (bool ok, bytes32 code) {
        return _check(agentId, PERM_DEAL, payeeId, token, amount);
    }

    /// @notice Charge a payment to an agent and its human's shared quota. Only spenders the agent's
    ///         human authorised (their GuardedVault) can call this.
    function consume(uint256 agentId, bytes32 payeeId, address token, uint256 amount) external {
        _consume(agentId, PERM_PAY, payeeId, token, amount);
    }

    /// @notice Charge a deal escrow to the paying agent and its human's quota (the network escrow).
    function consumeDeal(uint256 agentId, bytes32 payeeId, address token, uint256 amount) external {
        _consume(agentId, PERM_DEAL, payeeId, token, amount);
    }

    /// @notice A spender gives back a charge that never left (a cancelled or reclaimed deal): `amount` is taken
    ///         off the agent's and the human's spend for `day`. A spender can refund only what it charged that
    ///         agent that day, so a faulty spender cannot reset anyone's quota; and it can do so even after the
    ///         human stopped authorising it (refunds only ever lower spend), so an open deal never gets stuck.
    function refund(uint256 agentId, address token, uint256 amount, uint256 day) external {
        address h = humanOf(agentId);
        if (token != _agents[agentId - 1].token) revert BadToken();
        uint256 c = chargedBy[agentId][day][msg.sender];
        if (amount > c) revert OverRefund(c, amount);
        chargedBy[agentId][day][msg.sender] = c - amount;
        _agentSpent[agentId][day] -= amount;
        _humanSpent[h][token][day] -= amount;
        emit AgentRefunded(agentId, h, token, amount, day, msg.sender);
    }

    function _check(uint256 agentId, uint32 perm, bytes32 payeeId, address token, uint256 amount) private view returns (bool ok, bytes32 code) {
        (ok, code) = status(agentId);
        if (!ok) return (ok, code);
        Agent storage a = _agents[agentId - 1];
        if (a.permissions & perm == 0) return (false, "NOT_PERMITTED");
        if (token != a.token) return (false, "WRONG_TOKEN");
        if (!a.anyPayee && !payeeAllowed[agentId][payeeId]) return (false, "PAYEE_NOT_DELEGATED");
        if (amount == 0 || amount > a.perTxLimit) return (false, "OVER_AGENT_TX_LIMIT");
        uint256 day = block.timestamp / 1 days;
        if (_agentSpent[agentId][day] + amount > a.dailyLimit) return (false, "OVER_AGENT_DAILY_LIMIT");
        if (_humanSpent[a.human][token][day] + amount > quota[a.human][token]) return (false, "OVER_HUMAN_QUOTA");
        return (true, bytes32(0));
    }

    function _consume(uint256 agentId, uint32 perm, bytes32 payeeId, address token, uint256 amount) private {
        address h = humanOf(agentId);
        if (!isSpender[h][msg.sender]) revert NotSpender(msg.sender);
        (bool ok, bytes32 code) = _check(agentId, perm, payeeId, token, amount);
        if (!ok) revert AgentBlocked(code);
        uint256 day = block.timestamp / 1 days;
        _agentSpent[agentId][day] += amount;
        _humanSpent[h][token][day] += amount;
        chargedBy[agentId][day][msg.sender] += amount;
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

    /// @notice The network bans an agent when its arbiter upholds repeated reports.
    function ban(uint256 agentId) external {
        _onlyNetwork(agentId);
        banned[agentId] = true;
        emit AgentBanned(agentId);
    }

    /// @notice The network lifts a ban when its arbiter grants an appeal.
    function unban(uint256 agentId) external {
        _onlyNetwork(agentId);
        banned[agentId] = false;
        emit AgentUnbanned(agentId);
    }

    function _onlyNetwork(uint256 agentId) private view {
        if (msg.sender != network || network == address(0)) revert OnlyNetwork();
        if (agentId == 0 || agentId > _agents.length) revert UnknownAgent(agentId);
    }

    // ------------------------------------------------------------------ views

    function human(address h) external view returns (Human memory) {
        return _humans[h];
    }

    function agentsOf(address h) external view returns (uint256[] memory) {
        return _agentsOf[h];
    }

    /// @notice Every agent `h` ever registered, with live status and today's spend, in one call.
    function agentsView(address h) external view returns (AgentView[] memory out) {
        uint256[] storage ids = _agentsOf[h];
        out = new AgentView[](ids.length);
        uint256 day = block.timestamp / 1 days;
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            (bool ok, bytes32 code) = status(id);
            out[i] = AgentView({id: id, agent: _agents[id - 1], ok: ok, code: code, spentToday: _agentSpent[id][day]});
        }
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

    /// @notice What `agentId` spent today in `token` (an agent spends only its own token: 0 for any other).
    function spentToday(uint256 agentId, address token) external view returns (uint256) {
        if (agentId == 0 || agentId > _agents.length || _agents[agentId - 1].token != token) return 0;
        return _agentSpent[agentId][block.timestamp / 1 days];
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
