// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Phase A of the agents network: one human (bound to a QIE ID), many agents, one shared quota.
interface IAgentRegistry {
    struct Human {
        string qieId;
        uint64 boundAt;
        bool frozen;
        uint32 agentCount;
    }

    /// @dev An agent spends exactly one token (`token`); its limits are denominated in that token.
    struct Agent {
        address key;
        address human;
        address token;
        string label;
        bytes32 metaHash;
        uint32 permissions;
        uint128 perTxLimit;
        uint128 dailyLimit;
        uint64 createdAt;
        uint64 revokedAt;
        bool revoked;
        bool anyPayee;
    }

    /// @notice What a human asks for when registering an agent. The agent key co-signs (see registerAgent).
    struct NewAgent {
        address key;
        address token;
        string label;
        bytes32 metaHash;
        uint32 permissions;
        uint128 perTxLimit;
        uint128 dailyLimit;
        bool anyPayee;
    }

    /// @notice One row of `agentsView`: an agent with its live status and today's spend.
    struct AgentView {
        uint256 id;
        Agent agent;
        bool ok;
        bytes32 code;
        uint256 spentToday;
    }

    event HumanBound(address indexed human, string qieId, bytes32 indexed qieIdHash);
    event HumanFrozen(address indexed human, bool frozen);
    event QuotaSet(address indexed human, address indexed token, uint256 dailyQuota);
    event SpenderSet(address indexed human, address indexed spender, bool allowed);
    event AgentRegistered(uint256 indexed agentId, address indexed human, address indexed key, string label, bytes32 metaHash);
    event AgentTokenSet(uint256 indexed agentId, address token);
    event AgentPermissionsSet(uint256 indexed agentId, uint32 permissions);
    event AgentLimitsSet(uint256 indexed agentId, uint128 perTxLimit, uint128 dailyLimit);
    event AgentPayeeSet(uint256 indexed agentId, bytes32 indexed payeeId, bool allowed);
    event AgentAnyPayeeSet(uint256 indexed agentId, bool anyPayee);
    event AgentRevoked(uint256 indexed agentId, address indexed key, string reason);
    event AgentKeyRotated(uint256 indexed agentId, address indexed oldKey, address indexed newKey);
    event AgentBanned(uint256 indexed agentId);
    event AgentUnbanned(uint256 indexed agentId);
    event AgentSpent(uint256 indexed agentId, address indexed human, bytes32 indexed payeeId, address token, uint256 amount, address spender);
    event AgentRefunded(uint256 indexed agentId, address indexed human, address token, uint256 amount, uint256 day, address spender);
    event NetworkSet(address network);

    error QieIdNotOwned(string qieId);
    error NotBound(address human);
    error NotYourAgent(uint256 agentId);
    error UnknownAgent(uint256 agentId);
    error AgentIsRevoked(uint256 agentId);
    error BadKey(address key);
    error BadKeySignature();
    error SignatureExpired();
    error BadToken();
    error TooManyAgents();
    error NotSpender(address spender);
    error OverRefund(uint256 charged, uint256 amount);
    error AgentBlocked(bytes32 code);
    error OnlyNetwork();
    error NetworkAlreadySet();

    function isBound(address h) external view returns (bool);
    function humanOf(uint256 agentId) external view returns (address);
    function agent(uint256 agentId) external view returns (Agent memory);
    function agentIdOf(address key) external view returns (uint256);
    function status(uint256 agentId) external view returns (bool ok, bytes32 code);
    function hasPermission(uint256 agentId, uint32 permission) external view returns (bool);
    function check(uint256 agentId, bytes32 payeeId, address token, uint256 amount) external view returns (bool ok, bytes32 code);
    function checkDeal(uint256 agentId, bytes32 payeeId, address token, uint256 amount) external view returns (bool ok, bytes32 code);
    function consume(uint256 agentId, bytes32 payeeId, address token, uint256 amount) external;
    function consumeDeal(uint256 agentId, bytes32 payeeId, address token, uint256 amount) external;
    function refund(uint256 agentId, address token, uint256 amount, uint256 day) external;
    function ban(uint256 agentId) external;
    function unban(uint256 agentId) external;
}
