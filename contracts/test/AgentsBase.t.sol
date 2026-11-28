// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AgentNetwork} from "../src/AgentNetwork.sol";
import {TestQieId} from "../src/TestQieId.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Phase A (AgentRegistry + GuardedVault.payForAgent) and phase B (AgentNetwork) fixtures.
///      Humans: `owner` (alice.qie, owns the vault), bob (bob.qie), carol and dave (report).
abstract contract AgentsBase is Base {
    TestQieId internal qie;
    AgentRegistry internal agents;
    AgentNetwork internal net;
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal arbiter = makeAddr("arbiter");
    address internal council = makeAddr("council");
    address internal a1Key;
    uint256 internal a1Pk;
    address internal a2Key;
    uint256 internal a2Pk;
    address internal b1Key;
    uint256 internal b1Pk;
    uint256 internal a1;
    uint256 internal a2;
    uint256 internal b1;

    uint32 internal constant PAY = 1;
    uint32 internal constant MEM = 2;
    uint32 internal constant MSG = 4;
    uint32 internal constant DEAL = 8;
    uint32 internal constant ALL = 1 | 2 | 4 | 8;
    uint256 internal constant MIN_BOND = 10e6;
    uint256 internal constant REPORT_BOND = 2e6;
    uint64 internal constant WINDOW = 3 days;
    uint64 internal constant RULE = 7 days;
    bytes16 internal constant D1 = bytes16(keccak256("decision-1"));
    bytes16 internal constant D2 = bytes16(keccak256("decision-2"));

    function setUp() public virtual override {
        super.setUp();
        _addPayee(LANDLORD, landlord, 5e6, 5e6);
        (a1Key, a1Pk) = makeAddrAndKey("agent-a1");
        (a2Key, a2Pk) = makeAddrAndKey("agent-a2");
        (b1Key, b1Pk) = makeAddrAndKey("agent-b1");

        qie = new TestQieId();
        agents = new AgentRegistry(qie);
        net = new AgentNetwork(agents, IERC20(address(usd)), council, _params());
        agents.setNetwork(address(net));

        _bind(owner, "alice.qie");
        _bind(bob, "bob.qie");
        _bind(carol, "carol.qie");
        _bind(dave, "dave.qie");

        a1 = _register(owner, a1Pk, "rent agent", keccak256("model:x"), ALL, 4e6, 5e6, false);
        a2 = _register(owner, a2Pk, "bills agent", keccak256("model:y"), ALL, 4e6, 5e6, false);
        b1 = _register(bob, b1Pk, "bob's seller", bytes32(0), ALL, 50e6, 50e6, true);

        vm.startPrank(owner);
        vault.setAgentRegistry(agents);
        agents.setSpender(address(vault), true);
        agents.setSpender(address(net), true);
        agents.setQuota(address(usd), 6e6);
        bytes32[] memory p = new bytes32[](1);
        p[0] = LANDLORD;
        agents.setPayees(a1, p, true);
        agents.setPayees(a2, p, true);
        usd.mint(owner, 100e6);
        usd.mint(bob, 100e6);
        usd.mint(carol, 100e6);
        usd.mint(dave, 100e6);
        vm.stopPrank();

        vm.startPrank(bob);
        agents.setQuota(address(usd), 50e6);
        agents.setSpender(address(net), true);
        usd.approve(address(net), type(uint256).max);
        vm.stopPrank();
        vm.prank(owner);
        usd.approve(address(net), type(uint256).max);
        vm.prank(carol);
        usd.approve(address(net), type(uint256).max);
        vm.prank(dave);
        usd.approve(address(net), type(uint256).max);
    }

    function _params() internal view returns (AgentNetwork.Params memory) {
        return AgentNetwork.Params({
            arbiter: arbiter,
            minBond: MIN_BOND,
            reportBond: REPORT_BOND,
            contestWindow: WINDOW,
            ruleWindow: RULE,
            slashBps: 2_000,
            banAfter: 3
        });
    }

    function _bind(address h, string memory name) internal {
        vm.prank(h);
        qie.claim(name);
        vm.prank(h);
        agents.bindQieId(name);
    }

    function _spec(address key, uint32 perms, uint128 perTx, uint128 daily, bool any)
        internal
        view
        returns (IAgentRegistry.NewAgent memory)
    {
        return IAgentRegistry.NewAgent({
            key: key,
            token: address(usd),
            label: "x",
            metaHash: bytes32(0),
            permissions: perms,
            perTxLimit: perTx,
            dailyLimit: daily,
            anyPayee: any
        });
    }

    function _regSig(uint256 pk, address human, uint64 dl) internal view returns (bytes memory) {
        return _sign(pk, agents.registrationDigest(human, vm.addr(pk), dl));
    }

    /// Registers the key of `pk` under `human`, with the key's consent signature.
    function _register(
        address human,
        uint256 pk,
        string memory label,
        bytes32 meta,
        uint32 perms,
        uint128 perTx,
        uint128 daily,
        bool any
    ) internal returns (uint256) {
        IAgentRegistry.NewAgent memory n = _spec(vm.addr(pk), perms, perTx, daily, any);
        n.label = label;
        n.metaHash = meta;
        uint64 dl = uint64(block.timestamp + 1 hours);
        bytes memory sig = _regSig(pk, human, dl);
        vm.prank(human);
        return agents.registerAgent(n, dl, sig);
    }

    function _payFor(uint256 agentId, uint256 amount, bytes16 d) internal {
        vm.prank(vaultSigner);
        vault.payForAgent(agentId, LANDLORD, address(usd), amount, d);
    }

    function _code(uint256 agentId, uint256 amount) internal view returns (bytes32 code) {
        (, code) = agents.check(agentId, LANDLORD, address(usd), amount);
    }
}
