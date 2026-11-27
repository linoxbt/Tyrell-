// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AgentNetwork} from "../src/AgentNetwork.sol";
import {TestQieId} from "../src/TestQieId.sol";
import {GuardedVault} from "../src/GuardedVault.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";
import {IQieId} from "../src/interfaces/IQieId.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Phase A (AgentRegistry + GuardedVault.payForAgent) and phase B (AgentNetwork).
///      Humans: `owner` (alice.qie, owns the vault), bob (bob.qie), carol (carol.qie, reports).
contract AgentsTest is Base {
    TestQieId internal qie;
    AgentRegistry internal agents;
    AgentNetwork internal net;
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal arbiter = makeAddr("arbiter");
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
    uint32 internal constant MSG = 4;
    uint32 internal constant DEAL = 8;
    uint32 internal constant ALL = 1 | 2 | 4 | 8;
    uint256 internal constant MIN_BOND = 10e6;
    uint256 internal constant REPORT_BOND = 2e6;
    uint64 internal constant WINDOW = 3 days;
    bytes16 internal constant D1 = bytes16(keccak256("decision-1"));
    bytes16 internal constant D2 = bytes16(keccak256("decision-2"));

    function setUp() public override {
        super.setUp();
        _addPayee(LANDLORD, landlord, 5e6, 5e6);
        (a1Key, a1Pk) = makeAddrAndKey("agent-a1");
        (a2Key, a2Pk) = makeAddrAndKey("agent-a2");
        (b1Key, b1Pk) = makeAddrAndKey("agent-b1");

        qie = new TestQieId();
        agents = new AgentRegistry(qie);
        net = new AgentNetwork(agents, IERC20(address(usd)), arbiter, MIN_BOND, REPORT_BOND, WINDOW, 2_000, 3);
        agents.setNetwork(address(net));

        _bind(owner, "alice.qie");
        _bind(bob, "bob.qie");
        _bind(carol, "carol.qie");

        vm.startPrank(owner);
        vault.setAgentRegistry(agents);
        agents.setSpender(address(vault), true);
        agents.setSpender(address(net), true);
        agents.setQuota(address(usd), 6e6);
        a1 = agents.registerAgent(a1Key, "rent agent", keccak256("model:x"), ALL, 4e6, 5e6, false);
        a2 = agents.registerAgent(a2Key, "bills agent", keccak256("model:y"), ALL, 4e6, 5e6, false);
        bytes32[] memory p = new bytes32[](1);
        p[0] = LANDLORD;
        agents.setPayees(a1, p, true);
        agents.setPayees(a2, p, true);
        usd.mint(owner, 100e6);
        usd.mint(bob, 100e6);
        usd.mint(carol, 100e6);
        vm.stopPrank();

        vm.prank(bob);
        b1 = agents.registerAgent(b1Key, "bob's seller", bytes32(0), ALL, 50e6, 50e6, true);
        vm.prank(bob);
        agents.setQuota(address(usd), 50e6);
        vm.prank(bob);
        agents.setSpender(address(net), true);

        vm.prank(owner);
        usd.approve(address(net), type(uint256).max);
        vm.prank(bob);
        usd.approve(address(net), type(uint256).max);
        vm.prank(carol);
        usd.approve(address(net), type(uint256).max);
    }

    function _bind(address h, string memory name) internal {
        vm.prank(h);
        qie.claim(name);
        vm.prank(h);
        agents.bindQieId(name);
    }

    function _payFor(uint256 agentId, uint256 amount, bytes16 d) internal {
        vm.prank(vaultSigner);
        vault.payForAgent(agentId, LANDLORD, address(usd), amount, d);
    }

    function _code(uint256 agentId, uint256 amount) internal view returns (bytes32 code) {
        (, code) = agents.check(agentId, LANDLORD, address(usd), amount);
    }

    // =================================================================== phase A: QIE ID binding

    function test_bindRequiresHoldingTheQieId() public {
        address eve = makeAddr("eve");
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.QieIdNotOwned.selector, "alice.qie"));
        vm.prank(eve);
        agents.bindQieId("alice.qie");
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.QieIdNotOwned.selector, "nobody.qie"));
        vm.prank(eve);
        agents.bindQieId("nobody.qie");
        assertFalse(agents.isBound(eve));
        assertTrue(agents.isBound(owner));
        assertEq(agents.human(owner).qieId, "alice.qie");
        assertEq(agents.humanOfQieId(keccak256("alice.qie")), owner);
    }

    function test_bindEmitsAndRebindReplaces() public {
        vm.prank(owner);
        qie.claim("alice2.qie");
        vm.expectEmit(true, true, false, true, address(agents));
        emit IAgentRegistry.HumanBound(owner, "alice2.qie", keccak256("alice2.qie"));
        vm.prank(owner);
        agents.bindQieId("alice2.qie");
        assertEq(agents.humanOfQieId(keccak256("alice.qie")), address(0));
        assertEq(agents.humanOfQieId(keccak256("alice2.qie")), owner);
        assertTrue(agents.isBound(owner));
    }

    /// Every agent stays bound to its human's QIE ID: if the name moves, all of the human's agents stop.
    function test_agentsStopWhenTheQieIdMoves() public {
        assertEq(_code(a1, 1e6), bytes32(0));
        vm.prank(owner);
        qie.transferName("alice.qie", makeAddr("buyer"));
        assertFalse(agents.isBound(owner));
        assertEq(_code(a1, 1e6), "HUMAN_UNBOUND");
        assertEq(_code(a2, 1e6), "HUMAN_UNBOUND");
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.AgentBlocked.selector, bytes32("HUMAN_UNBOUND")));
        _payFor(a1, 1e6, D1);
        // and no new agent can be registered
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotBound.selector, owner));
        vm.prank(owner);
        agents.registerAgent(makeAddr("k"), "x", 0, PAY, 1, 1, true);
    }

    function test_agentsStopWhenTheQieIdLapses() public {
        vm.prank(owner);
        qie.lapse("alice.qie"); // the mainnet store reverts for expired free names
        assertFalse(agents.isBound(owner));
        (bool ok, bytes32 code) = agents.status(a1);
        assertFalse(ok);
        assertEq(code, "HUMAN_UNBOUND");
        vm.prank(owner);
        qie.claim("alice.qie"); // renewed
        assertTrue(agents.isBound(owner));
        (ok,) = agents.status(a1);
        assertTrue(ok);
    }

    function test_newHolderOfAMovedNameTakesTheBinding() public {
        address buyer = makeAddr("buyer");
        vm.prank(owner);
        qie.transferName("alice.qie", buyer);
        vm.prank(buyer);
        agents.bindQieId("alice.qie");
        assertEq(agents.humanOfQieId(keccak256("alice.qie")), buyer);
        assertEq(agents.human(owner).qieId, "");
        assertTrue(agents.isBound(buyer));
        assertFalse(agents.isBound(owner));
    }

    function test_resolverOnlyCountsTheQieRecord() public view {
        assertEq(IQieId(address(qie)).resolveCurrency("alice.qie", "bitcoin"), address(0));
        assertEq(IQieId(address(qie)).resolveCurrency("alice.qie", "qie"), owner);
    }

    // =================================================================== phase A: agents

    function test_registerAgentRules() public {
        address k = makeAddr("k");
        address eve = makeAddr("eve");
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotBound.selector, eve));
        vm.prank(eve);
        agents.registerAgent(k, "x", 0, PAY, 1, 1, true);

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.BadKey.selector, address(0)));
        agents.registerAgent(address(0), "x", 0, PAY, 1, 1, true);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.BadKey.selector, owner));
        agents.registerAgent(owner, "x", 0, PAY, 1, 1, true);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.BadKey.selector, a1Key));
        agents.registerAgent(a1Key, "x", 0, PAY, 1, 1, true);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.BadKey.selector, bob));
        agents.registerAgent(bob, "x", 0, PAY, 1, 1, true); // another human's address
        vm.expectEmit(true, true, true, true, address(agents));
        emit IAgentRegistry.AgentRegistered(4, owner, k, "x", bytes32("m"));
        uint256 id = agents.registerAgent(k, "x", bytes32("m"), PAY, 1, 1, true);
        vm.stopPrank();

        assertEq(id, 4);
        assertEq(agents.agentIdOf(k), 4);
        assertEq(agents.humanOf(id), owner);
        assertEq(agents.agentCount(), 4);
        assertEq(agents.human(owner).agentCount, 3);
        uint256[] memory mine = agents.agentsOf(owner);
        assertEq(mine.length, 3);
        assertEq(mine[2], 4);
        IAgentRegistry.Agent memory a = agents.agent(id);
        assertEq(a.key, k);
        assertEq(a.label, "x");
        assertTrue(a.anyPayee);
    }

    function test_maxAgentsPerHuman() public {
        vm.startPrank(owner);
        for (uint256 i = 2; i < agents.MAX_AGENTS(); ++i) {
            agents.registerAgent(address(uint160(0x1000 + i)), "n", 0, PAY, 1, 1, true);
        }
        vm.expectRevert(IAgentRegistry.TooManyAgents.selector);
        agents.registerAgent(address(0x9999), "n", 0, PAY, 1, 1, true);
        vm.stopPrank();
    }

    function test_onlyTheHumanManagesTheirAgents() public {
        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotYourAgent.selector, a1));
        agents.setLimits(a1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotYourAgent.selector, a1));
        agents.setPermissions(a1, 0);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotYourAgent.selector, a1));
        agents.revokeAgent(a1, "x");
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.UnknownAgent.selector, 99));
        agents.setAnyPayee(99, true);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.UnknownAgent.selector, 0));
        agents.agent(0);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.UnknownAgent.selector, 99));
        agents.humanOf(99);
    }

    function test_delegatedPermissionsAndPayees() public {
        assertEq(_code(a1, 1e6), bytes32(0));
        vm.prank(owner);
        agents.setPermissions(a1, MSG); // no PAY
        assertEq(_code(a1, 1e6), "NOT_PERMITTED");
        assertFalse(agents.hasPermission(a1, PAY));
        assertTrue(agents.hasPermission(a1, MSG));
        assertFalse(agents.hasPermission(0, MSG));

        vm.prank(owner);
        agents.setPermissions(a1, PAY);
        bytes32[] memory p = new bytes32[](1);
        p[0] = LANDLORD;
        vm.prank(owner);
        agents.setPayees(a1, p, false);
        assertEq(_code(a1, 1e6), "PAYEE_NOT_DELEGATED");
        vm.prank(owner);
        agents.setAnyPayee(a1, true);
        assertEq(_code(a1, 1e6), bytes32(0));
    }

    function test_perAgentLimits() public {
        assertEq(_code(a1, 0), "OVER_AGENT_TX_LIMIT");
        assertEq(_code(a1, 4e6 + 1), "OVER_AGENT_TX_LIMIT");
        _payFor(a1, 4e6, D1);
        assertEq(agents.spentToday(a1, address(usd)), 4e6);
        assertEq(_code(a1, 1e6 + 1), "OVER_AGENT_DAILY_LIMIT");
        vm.prank(owner);
        agents.setLimits(a1, 4e6, 9e6);
        assertEq(_code(a1, 1e6 + 1), bytes32(0));
    }

    /// N agents, 1 human, 1 shared quota.
    function test_sharedHumanQuotaAcrossAgents() public {
        vm.prank(owner);
        vault.setGlobalDailyCap(address(usd), 100e6);
        _payFor(a1, 4e6, D1); // human spent 4 of 6
        assertEq(agents.humanSpentToday(owner, address(usd)), 4e6);
        assertEq(_code(a2, 2e6 + 1), "OVER_HUMAN_QUOTA");
        assertEq(_code(a2, 1e6), bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.AgentBlocked.selector, bytes32("OVER_HUMAN_QUOTA")));
        _payFor(a2, 3e6, D2);
        // tomorrow the quota resets
        vm.warp(block.timestamp + 1 days);
        assertEq(agents.humanSpentToday(owner, address(usd)), 0);
        assertEq(_code(a2, 4e6), bytes32(0));
    }

    function test_noQuotaFailsClosed() public {
        vm.prank(owner);
        agents.setQuota(address(usd), 0);
        assertEq(_code(a1, 1), "OVER_HUMAN_QUOTA");
    }

    function test_freezeStopsEveryAgent() public {
        vm.expectEmit(true, false, false, true, address(agents));
        emit IAgentRegistry.HumanFrozen(owner, true);
        vm.prank(owner);
        agents.freeze(true);
        assertEq(_code(a1, 1e6), "HUMAN_FROZEN");
        assertEq(_code(a2, 1e6), "HUMAN_FROZEN");
        vm.prank(owner);
        agents.freeze(false);
        assertEq(_code(a1, 1e6), bytes32(0));
    }

    function test_revokeIsPermanentAndPerAgent() public {
        vm.expectEmit(true, true, false, true, address(agents));
        emit IAgentRegistry.AgentRevoked(a1, a1Key, "leaked");
        vm.prank(owner);
        agents.revokeAgent(a1, "leaked");
        assertEq(_code(a1, 1e6), "AGENT_REVOKED");
        assertEq(_code(a2, 1e6), bytes32(0)); // the other agent keeps working
        assertEq(agents.agentIdOf(a1Key), 0);
        assertEq(agents.human(owner).agentCount, 1);
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.AgentIsRevoked.selector, a1));
        agents.setLimits(a1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.BadKey.selector, a1Key));
        agents.registerAgent(a1Key, "again", 0, PAY, 1, 1, true);
        vm.stopPrank();
        (bool ok, bytes32 code) = agents.status(999);
        assertFalse(ok);
        assertEq(code, "UNKNOWN_AGENT");
    }

    function test_onlyAuthorisedSpendersCanCharge() public {
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotSpender.selector, address(this)));
        agents.consume(a1, LANDLORD, address(usd), 1e6);
        vm.prank(owner);
        agents.setSpender(address(vault), false);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotSpender.selector, address(vault)));
        _payFor(a1, 1e6, D1);
    }

    function test_networkLinkAndBanAreGuarded() public {
        vm.expectRevert(IAgentRegistry.NetworkAlreadySet.selector);
        agents.setNetwork(address(1));
        vm.expectRevert(IAgentRegistry.OnlyNetwork.selector);
        vm.prank(bob);
        agents.setNetwork(address(1));
        vm.expectRevert(IAgentRegistry.OnlyNetwork.selector);
        agents.ban(a1);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.UnknownAgent.selector, 42));
        vm.prank(address(net));
        agents.ban(42);
    }

    // =================================================================== phase A: the vault

    function test_payForAgentHappyPath() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit GuardedVault.PaidForAgent(a1, LANDLORD, address(usd), 3e6, D1);
        _payFor(a1, 3e6, D1);
        assertEq(usd.balanceOf(landlord), 3e6);
        assertEq(agents.spentToday(a1, address(usd)), 3e6);
        assertEq(vault.spentToday(LANDLORD), 3e6);
    }

    function test_payForAgentStillAppliesEveryVaultRule() public {
        // unregistered payee: the agent may pay anyone, the vault still refuses
        vm.prank(owner);
        agents.setAnyPayee(a1, true);
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotPayable.selector, bytes32("UNKNOWN_PAYEE")));
        vm.prank(vaultSigner);
        vault.payForAgent(a1, keccak256("payee:attacker"), address(usd), 1e6, D1);
        assertEq(agents.spentToday(a1, address(usd)), 0); // the whole call reverted
        // decision replay
        _payFor(a1, 1e6, D1);
        vm.expectRevert(GuardedVault.BadDecision.selector);
        _payFor(a1, 1e6, D1);
        // only the signer
        vm.expectRevert();
        vault.payForAgent(a1, LANDLORD, address(usd), 1e6, D2);
    }

    function test_payForAgentNeedsARegistry() public {
        vm.prank(owner);
        vault.setAgentRegistry(IAgentRegistry(address(0)));
        vm.expectRevert(GuardedVault.NoAgentRegistry.selector);
        _payFor(a1, 1e6, D1);
    }

    function testFuzz_sharedQuotaNeverExceeded(uint96[6] memory amounts, uint8 days_) public {
        vm.prank(owner);
        vault.setGlobalDailyCap(address(usd), type(uint128).max);
        vm.prank(owner);
        usd.mint(address(vault), 1_000e6);
        uint256 day = block.timestamp / 1 days;
        uint256 spent;
        for (uint256 i; i < amounts.length; ++i) {
            if (i == 3 && days_ % 2 == 1) {
                vm.warp(block.timestamp + 1 days);
                day++;
                spent = 0;
            }
            uint256 id = i % 2 == 0 ? a1 : a2;
            uint256 amt = bound(amounts[i], 1, 5e6);
            (bool ok,) = agents.check(id, LANDLORD, address(usd), amt);
            if (ok && amt + vault.spentToday(LANDLORD) <= 5e6) {
                vm.prank(vaultSigner);
                vault.payForAgent(id, LANDLORD, address(usd), amt, bytes16(uint128(i + 1)));
                spent += amt;
            }
            assertLe(agents.humanSpentToday(owner, address(usd)), 6e6);
            assertLe(agents.spentToday(a1, address(usd)), 5e6);
            assertLe(agents.spentToday(a2, address(usd)), 5e6);
            assertEq(agents.humanSpentToday(owner, address(usd)), spent);
        }
        assertEq(block.timestamp / 1 days, day);
    }

    // =================================================================== phase B: bonds

    function test_constructorRejectsBadParams() public {
        vm.expectRevert(AgentNetwork.BadParams.selector);
        new AgentNetwork(agents, IERC20(address(usd)), arbiter, 0, 1, 1, 1, 1);
        vm.expectRevert(AgentNetwork.BadParams.selector);
        new AgentNetwork(agents, IERC20(address(usd)), arbiter, 1, 1, 1, 10_001, 1);
        vm.expectRevert(AgentNetwork.BadParams.selector);
        new AgentNetwork(agents, IERC20(address(usd)), address(0), 1, 1, 1, 1, 1);
    }

    function test_bondAndWithdraw() public {
        vm.expectRevert(AgentNetwork.BadAmount.selector);
        vm.prank(owner);
        net.bond(a1, 0);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.UnknownAgent.selector, 77));
        vm.prank(owner);
        net.bond(77, 1e6);

        vm.prank(owner);
        net.bond(a1, 15e6);
        assertTrue(net.isBonded(a1));
        assertEq(net.bondOf(a1), 15e6);

        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, a1));
        vm.prank(bob);
        net.withdrawBond(a1, 1e6);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.BelowMinBond.selector, a1));
        vm.prank(owner);
        net.withdrawBond(a1, 6e6); // would leave 9 < 10
        vm.expectRevert(AgentNetwork.BadAmount.selector);
        vm.prank(owner);
        net.withdrawBond(a1, 16e6);
        uint256 before = usd.balanceOf(owner);
        vm.prank(owner);
        net.withdrawBond(a1, 5e6);
        vm.prank(owner);
        net.withdrawBond(a1, 10e6); // leave the network entirely
        assertEq(usd.balanceOf(owner), before + 15e6);
        assertFalse(net.isBonded(a1));
    }

    // =================================================================== phase B: reports and disputes

    function _report(address reporter, uint256 agentId) internal returns (uint256) {
        vm.prank(reporter);
        return net.fileReport(agentId, 1, keccak256(abi.encode(agentId, reporter, block.timestamp)), "ipfs://evidence");
    }

    function test_reportRules() public {
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotBound.selector, attacker));
        vm.prank(attacker);
        net.fileReport(b1, 1, bytes32("e"), "");
        vm.expectRevert(AgentNetwork.SelfReport.selector);
        vm.prank(bob);
        net.fileReport(b1, 1, bytes32("e"), "");
        vm.expectRevert(AgentNetwork.BadParams.selector);
        vm.prank(carol);
        net.fileReport(b1, 1, bytes32(0), "");
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.UnknownReport.selector, 5));
        net.report(5);
    }

    function test_uncontestedReportIsUpheldAndSlashes() public {
        vm.prank(bob);
        net.bond(b1, 20e6);
        uint256 carolBefore = usd.balanceOf(carol);
        uint256 r = _report(carol, b1);
        assertEq(net.openReports(b1), 1);
        // the accused cannot pull the bond while the report is open
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.OpenReports.selector, b1));
        vm.prank(bob);
        net.withdrawBond(b1, 20e6);
        vm.expectRevert(AgentNetwork.WindowOpen.selector);
        net.finalize(r);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectEmit(true, true, false, true, address(net));
        emit AgentNetwork.ReportUpheld(r, b1, 4e6, false); // 20% of 20
        net.finalize(r);
        assertEq(net.bondOf(b1), 16e6);
        assertEq(usd.balanceOf(carol), carolBefore + 4e6); // report bond back + slash
        assertEq(net.record(b1).reportsUpheld, 1);
        assertEq(net.openReports(b1), 0);
        assertEq(uint8(net.report(r).status), uint8(AgentNetwork.ReportStatus.Upheld));
        vm.expectRevert(AgentNetwork.WrongStatus.selector);
        net.finalize(r);
    }

    function test_contestedReportArbiterUpholds() public {
        vm.prank(bob);
        net.bond(b1, 20e6);
        uint256 r = _report(carol, b1);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, b1));
        vm.prank(carol);
        net.contest(r);
        vm.prank(bob);
        net.contest(r);
        vm.expectRevert(AgentNetwork.WrongStatus.selector);
        net.finalize(r);
        vm.expectRevert(AgentNetwork.OnlyArbiter.selector);
        vm.prank(carol);
        net.resolve(r, true);
        uint256 carolBefore = usd.balanceOf(carol);
        vm.prank(arbiter);
        net.resolve(r, true);
        // carol: her bond + bob's contest bond + the 20% slash
        assertEq(usd.balanceOf(carol), carolBefore + REPORT_BOND * 2 + 4e6);
    }

    function test_contestedReportArbiterDismisses() public {
        vm.prank(bob);
        net.bond(b1, 20e6);
        uint256 r = _report(carol, b1);
        vm.prank(bob);
        net.contest(r);
        uint256 bobBefore = usd.balanceOf(bob);
        vm.expectEmit(true, true, false, false, address(net));
        emit AgentNetwork.ReportDismissed(r, b1);
        vm.prank(arbiter);
        net.resolve(r, false);
        assertEq(usd.balanceOf(bob), bobBefore + REPORT_BOND * 2);
        assertEq(net.bondOf(b1), 20e6);
        assertEq(net.falseReports(carol), 1);
        assertEq(net.record(b1).reportsDismissed, 1);
        vm.expectRevert(AgentNetwork.WrongStatus.selector);
        vm.prank(arbiter);
        net.resolve(r, true);
    }

    function test_contestWindowCloses() public {
        uint256 r = _report(carol, b1);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectRevert(AgentNetwork.WindowClosed.selector);
        vm.prank(bob);
        net.contest(r);
    }

    function test_threeUpheldReportsBanTheAgent() public {
        vm.prank(bob);
        net.bond(b1, 20e6);
        for (uint256 i; i < 3; ++i) {
            uint256 r = _report(carol, b1);
            vm.warp(block.timestamp + WINDOW + 1);
            net.finalize(r);
        }
        assertTrue(agents.banned(b1));
        (bool ok, bytes32 code) = agents.status(b1);
        assertFalse(ok);
        assertEq(code, "AGENT_BANNED");
        assertEq(net.reputation(b1), 0);
    }

    // =================================================================== phase B: reputation

    function test_reputationReflectsHistory() public {
        assertEq(net.reputation(b1), 500);
        vm.prank(bob);
        net.bond(b1, 30e6); // 3 x minBond -> +60
        assertEq(net.reputation(b1), 560);
        vm.prank(bob);
        net.bond(b1, 50e6); // 8 x minBond: capped at +100
        assertEq(net.reputation(b1), 600);
        uint256 r = _report(carol, b1);
        vm.warp(block.timestamp + WINDOW + 1);
        net.finalize(r); // -150; the bond shrinks by 20% (64 = 6 x minBond, still capped at +100)
        assertEq(net.reputation(b1), 450);
        assertEq(net.reputation(999), 0);
    }

    // =================================================================== phase B: agent-to-agent messages

    function _msgSig(uint256 pk, uint256 from, uint256 to, bytes32 body, uint256 nonce, uint64 dl) internal view returns (bytes memory) {
        return _sign(pk, net.messageDigest(from, to, body, nonce, dl));
    }

    function _verify(uint256 from, uint256 to, bytes memory sig, uint64 dl) internal view returns (bytes32 code) {
        (, code) = net.verifyMessage(from, to, bytes32("hello"), 1, dl, sig);
    }

    function test_agentMessages() public {
        uint64 dl = uint64(block.timestamp + 1 hours);
        vm.prank(owner);
        net.bond(a1, MIN_BOND);
        bytes memory good = _msgSig(a1Pk, a1, b1, bytes32("hello"), 1, dl);
        (bool ok,) = net.verifyMessage(a1, b1, bytes32("hello"), 1, dl, good);
        assertTrue(ok);
        assertEq(_verify(a1, b1, _msgSig(b1Pk, a1, b1, bytes32("hello"), 1, dl), dl), "BAD_SIGNATURE"); // wrong key
        assertEq(_verify(a1, b1, hex"1234", dl), "BAD_SIGNATURE");
        assertEq(_verify(a2, b1, _msgSig(a2Pk, a2, b1, bytes32("hello"), 1, dl), dl), "NOT_BONDED");
        vm.warp(dl + 1);
        assertEq(_verify(a1, b1, good, dl), "EXPIRED");
        vm.warp(dl - 1);
        vm.prank(owner);
        agents.setPermissions(a1, PAY);
        assertEq(_verify(a1, b1, good, dl), "NOT_PERMITTED");
        vm.prank(bob);
        agents.revokeAgent(b1, "retired");
        assertEq(_verify(a1, b1, good, dl), "RECIPIENT_INACTIVE");
        vm.prank(owner);
        agents.freeze(true);
        assertEq(_verify(a1, b1, good, dl), "HUMAN_FROZEN");
        assertTrue(net.domainSeparator() != bytes32(0));
    }

    // =================================================================== phase B: agent-to-agent deals

    function _openDeal(uint256 amount) internal returns (uint256) {
        vm.prank(owner);
        return net.openDeal(a1, b1, address(usd), amount, keccak256("terms"), uint64(block.timestamp + 1 days));
    }

    function _bondBoth() internal {
        vm.prank(owner);
        net.bond(a1, MIN_BOND);
        vm.prank(bob);
        net.bond(b1, MIN_BOND);
        bytes32[] memory p = new bytes32[](1);
        p[0] = bytes32(b1);
        vm.prank(owner);
        agents.setPayees(a1, p, true);
    }

    function test_dealConfirmedPaysAndBuildsReputation() public {
        _bondBoth();
        uint256 bobBefore = usd.balanceOf(bob);
        uint256 d = _openDeal(3e6);
        assertEq(usd.balanceOf(address(net)), 2 * MIN_BOND + 3e6);
        assertEq(agents.spentToday(a1, address(usd)), 3e6); // counts against a1's limit and the quota
        assertEq(agents.humanSpentToday(owner, address(usd)), 3e6);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, a1));
        vm.prank(bob);
        net.confirmDeal(d);
        vm.prank(owner);
        net.confirmDeal(d);
        assertEq(usd.balanceOf(bob), bobBefore + 3e6);
        assertEq(net.record(a1).dealsCompleted, 1);
        assertEq(net.record(b1).dealsCompleted, 1);
        assertEq(net.record(b1).volume, 3e6);
        assertEq(net.reputation(b1), 530); // 500 + 10 deal + 20 bond
        assertEq(uint8(net.deal(d).status), uint8(AgentNetwork.DealStatus.Completed));
        assertEq(net.dealCount(), 1);
        vm.expectRevert(AgentNetwork.WrongStatus.selector);
        vm.prank(owner);
        net.confirmDeal(d);
    }

    function test_dealCancelAndReclaim() public {
        _bondBoth();
        uint256 ownerBefore = usd.balanceOf(owner);
        uint256 d = _openDeal(2e6);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, b1));
        vm.prank(owner);
        net.cancelDeal(d);
        vm.prank(bob);
        net.cancelDeal(d);
        assertEq(usd.balanceOf(owner), ownerBefore);

        uint256 d2 = _openDeal(1e6);
        vm.expectRevert(AgentNetwork.DeadlineNotPassed.selector);
        vm.prank(owner);
        net.reclaim(d2);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, a1));
        vm.prank(bob);
        net.reclaim(d2);
        vm.prank(owner);
        net.reclaim(d2);
        assertEq(usd.balanceOf(owner), ownerBefore);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.UnknownDeal.selector, 9));
        net.deal(9);
    }

    function test_dealRules() public {
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotBonded.selector, a1));
        _openDeal(1e6);
        _bondBoth();
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, a1));
        vm.prank(bob);
        net.openDeal(a1, b1, address(usd), 1e6, 0, uint64(block.timestamp + 1));
        vm.expectRevert(AgentNetwork.SameHuman.selector);
        vm.prank(owner);
        net.openDeal(a1, a2, address(usd), 1e6, 0, uint64(block.timestamp + 1));
        vm.expectRevert(AgentNetwork.DeadlinePassed.selector);
        vm.prank(owner);
        net.openDeal(a1, b1, address(usd), 1e6, 0, uint64(block.timestamp));
        // the paying agent's limits apply to deals too
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.AgentBlocked.selector, bytes32("OVER_AGENT_TX_LIMIT")));
        _openDeal(4e6 + 1);
        vm.prank(owner);
        agents.setPermissions(a1, PAY);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotPermitted.selector, a1));
        _openDeal(1e6);
        vm.prank(bob);
        agents.revokeAgent(b1, "gone");
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.AgentNotActive.selector, b1, bytes32("AGENT_REVOKED")));
        _openDeal(1e6);
    }
}
