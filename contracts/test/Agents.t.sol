// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {AgentsBase} from "./AgentsBase.t.sol";
import {GuardedVault} from "../src/GuardedVault.sol";
import {MemoryAnchor} from "../src/MemoryAnchor.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";
import {IQieId} from "../src/interfaces/IQieId.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Phase A: AgentRegistry, GuardedVault.payForAgent, and the MemoryAnchor agent gate.
contract AgentsTest is AgentsBase {
    // =================================================================== QIE ID binding

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
        (, uint256 pk) = makeAddrAndKey("k");
        IAgentRegistry.NewAgent memory n = _spec(vm.addr(pk), PAY, 1, 1, true);
        bytes memory sig = _regSig(pk, owner, uint64(block.timestamp));
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotBound.selector, owner));
        vm.prank(owner);
        agents.registerAgent(n, uint64(block.timestamp), sig);
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

    // =================================================================== registration (S-1: no key squatting)

    function test_registerAgentRules() public {
        (address k, uint256 kPk) = makeAddrAndKey("k");
        uint64 dl = uint64(block.timestamp + 1 hours);
        address eve = makeAddr("eve");
        bytes memory eveSig = _regSig(kPk, eve, dl);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotBound.selector, eve));
        vm.prank(eve);
        agents.registerAgent(_spec(k, PAY, 1, 1, true), dl, eveSig);

        bytes memory sig = _regSig(kPk, owner, dl);
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.BadKey.selector, address(0)));
        agents.registerAgent(_spec(address(0), PAY, 1, 1, true), dl, sig);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.BadKey.selector, owner));
        agents.registerAgent(_spec(owner, PAY, 1, 1, true), dl, sig);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.BadKey.selector, a1Key));
        agents.registerAgent(_spec(a1Key, PAY, 1, 1, true), dl, sig);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.BadKey.selector, bob));
        agents.registerAgent(_spec(bob, PAY, 1, 1, true), dl, sig); // another human's address
        IAgentRegistry.NewAgent memory noToken = _spec(k, PAY, 1, 1, true);
        noToken.token = address(0);
        vm.expectRevert(IAgentRegistry.BadToken.selector);
        agents.registerAgent(noToken, dl, sig);

        IAgentRegistry.NewAgent memory n = _spec(k, PAY, 1, 1, true);
        n.metaHash = bytes32("m");
        vm.expectEmit(true, true, true, true, address(agents));
        emit IAgentRegistry.AgentRegistered(4, owner, k, "x", bytes32("m"));
        vm.expectEmit(true, false, false, true, address(agents));
        emit IAgentRegistry.AgentTokenSet(4, address(usd));
        uint256 id = agents.registerAgent(n, dl, sig);
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
        assertEq(a.token, address(usd));
        assertEq(a.label, "x");
        assertTrue(a.anyPayee);
    }

    /// Agent keys are public. Without the key's own consent nobody can register it first.
    function test_agentKeysCannotBeSquatted() public {
        (address k, uint256 kPk) = makeAddrAndKey("victim-agent-key");
        uint64 dl = uint64(block.timestamp + 1 hours);
        IAgentRegistry.NewAgent memory n = _spec(k, ALL, 1e6, 1e6, true);

        // bob has no signature from the key at all
        vm.expectRevert(IAgentRegistry.BadKeySignature.selector);
        vm.prank(bob);
        agents.registerAgent(n, dl, hex"1234");
        // bob replays the signature the key gave to its real human (owner): it names owner, not bob
        bytes memory ownersSig = _regSig(kPk, owner, dl);
        vm.expectRevert(IAgentRegistry.BadKeySignature.selector);
        vm.prank(bob);
        agents.registerAgent(n, dl, ownersSig);
        // bob signs with some other key
        bytes memory forged = _sign(b1Pk, agents.registrationDigest(bob, k, dl));
        vm.expectRevert(IAgentRegistry.BadKeySignature.selector);
        vm.prank(bob);
        agents.registerAgent(n, dl, forged);
        // an expired consent is refused
        vm.warp(dl + 1);
        vm.expectRevert(IAgentRegistry.SignatureExpired.selector);
        vm.prank(owner);
        agents.registerAgent(n, dl, ownersSig);
        // the real human, in time
        vm.warp(dl - 10);
        vm.prank(owner);
        uint256 id = agents.registerAgent(n, dl, ownersSig);
        assertEq(agents.humanOf(id), owner);
        // and the same consent cannot be used twice (a key registers once, ever)
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.BadKey.selector, k));
        vm.prank(owner);
        agents.registerAgent(n, dl, ownersSig);
        assertTrue(agents.domainSeparator() != bytes32(0));
    }

    function test_maxAgentsPerHuman() public {
        for (uint256 i = 2; i < agents.MAX_AGENTS(); ++i) {
            _register(owner, 0x1000 + i, "n", 0, PAY, 1, 1, true);
        }
        uint256 pk = 0x9999;
        IAgentRegistry.NewAgent memory n = _spec(vm.addr(pk), PAY, 1, 1, true);
        bytes memory sig = _regSig(pk, owner, uint64(block.timestamp));
        vm.expectRevert(IAgentRegistry.TooManyAgents.selector);
        vm.prank(owner);
        agents.registerAgent(n, uint64(block.timestamp), sig);
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

    /// B-11: an agent spends one token and has one daily limit; it can't spend its limit again in another token.
    function test_agentLimitsAreNotPerToken() public {
        address other = makeAddr("other-token");
        vm.prank(owner);
        agents.setQuota(other, 100e6);
        (bool ok, bytes32 code) = agents.check(a1, LANDLORD, other, 1e6);
        assertFalse(ok);
        assertEq(code, "WRONG_TOKEN");
        (ok, code) = agents.checkDeal(a1, LANDLORD, other, 1e6);
        assertEq(code, "WRONG_TOKEN");
        assertEq(agents.spentToday(a1, other), 0);
        assertEq(agents.spentToday(99, address(usd)), 0);
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
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.AgentIsRevoked.selector, a1));
        vm.prank(owner);
        agents.setLimits(a1, 1, 1);
        IAgentRegistry.NewAgent memory n = _spec(a1Key, PAY, 1, 1, true);
        bytes memory sig = _regSig(a1Pk, owner, uint64(block.timestamp));
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.BadKey.selector, a1Key));
        vm.prank(owner);
        agents.registerAgent(n, uint64(block.timestamp), sig);
        (bool ok, bytes32 code) = agents.status(999);
        assertFalse(ok);
        assertEq(code, "UNKNOWN_AGENT");
    }

    function test_onlyAuthorisedSpendersCanChargeOrRefund() public {
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotSpender.selector, address(this)));
        agents.consume(a1, LANDLORD, address(usd), 1e6);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotSpender.selector, address(this)));
        agents.consumeDeal(a1, LANDLORD, address(usd), 1e6);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotSpender.selector, address(this)));
        agents.refund(a1, address(usd), 1e6, block.timestamp / 1 days);
        vm.prank(owner);
        agents.setSpender(address(vault), false);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.NotSpender.selector, address(vault)));
        _payFor(a1, 1e6, D1);
    }

    function test_refundNeverGoesBelowZero() public {
        _payFor(a1, 2e6, D1);
        uint256 day = block.timestamp / 1 days;
        vm.prank(address(net));
        agents.refund(a1, address(usd), 5e6, day);
        assertEq(agents.spentToday(a1, address(usd)), 0);
        assertEq(agents.humanSpentToday(owner, address(usd)), 0);
    }

    function test_networkLinkBanAndUnbanAreGuarded() public {
        vm.expectRevert(IAgentRegistry.NetworkAlreadySet.selector);
        agents.setNetwork(address(1));
        vm.expectRevert(IAgentRegistry.OnlyNetwork.selector);
        vm.prank(bob);
        agents.setNetwork(address(1));
        vm.expectRevert(IAgentRegistry.OnlyNetwork.selector);
        agents.ban(a1);
        vm.expectRevert(IAgentRegistry.OnlyNetwork.selector);
        agents.unban(a1);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.UnknownAgent.selector, 42));
        vm.prank(address(net));
        agents.ban(42);
        vm.prank(address(net));
        agents.ban(a1);
        assertEq(_code(a1, 1e6), "AGENT_BANNED");
        vm.expectEmit(true, false, false, false, address(agents));
        emit IAgentRegistry.AgentUnbanned(a1);
        vm.prank(address(net));
        agents.unban(a1);
        assertEq(_code(a1, 1e6), bytes32(0));
    }

    /// Perf: one call returns every agent with status and today's spend.
    function test_agentsView() public {
        _payFor(a1, 1e6, D1);
        vm.prank(owner);
        agents.revokeAgent(a2, "gone");
        IAgentRegistry.AgentView[] memory v = agents.agentsView(owner);
        assertEq(v.length, 2);
        assertEq(v[0].id, a1);
        assertTrue(v[0].ok);
        assertEq(v[0].spentToday, 1e6);
        assertEq(v[0].agent.key, a1Key);
        assertEq(v[1].id, a2);
        assertFalse(v[1].ok);
        assertEq(v[1].code, "AGENT_REVOKED");
        assertEq(agents.agentsView(makeAddr("nobody")).length, 0);
    }

    // =================================================================== the vault

    function test_payForAgentHappyPath() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit GuardedVault.PaidForAgent(a1, LANDLORD, address(usd), 3e6, D1);
        _payFor(a1, 3e6, D1);
        assertEq(usd.balanceOf(landlord), 3e6);
        assertEq(agents.spentToday(a1, address(usd)), 3e6);
        assertEq(vault.spentToday(LANDLORD), 3e6);
    }

    /// S-1: the vault pays only for agents of its own human, even if another human made it their spender.
    function test_payForAgentOnlyForTheVaultsHuman() public {
        vm.prank(bob);
        agents.setSpender(address(vault), true); // bob tries to charge his agent through owner's vault
        vm.expectRevert(abi.encodeWithSelector(GuardedVault.NotOurAgent.selector, b1));
        _payFor(b1, 1e6, D1);
        assertEq(usd.balanceOf(landlord), 0);
    }

    /// S-8: once a registry is linked, the plain path is closed, so agent rules can't be skipped.
    function test_plainPayClosedOnceARegistryIsLinked() public {
        vm.expectRevert(GuardedVault.UseAgentPath.selector);
        vm.prank(vaultSigner);
        vault.pay(LANDLORD, address(usd), 1e6, D1);
        vm.prank(owner);
        agents.freeze(true);
        vm.expectRevert(GuardedVault.UseAgentPath.selector);
        vm.prank(vaultSigner);
        vault.pay(LANDLORD, address(usd), 1e6, D1);
        // unlinking reopens it (owner decision)
        vm.prank(owner);
        vault.setAgentRegistry(IAgentRegistry(address(0)));
        vm.prank(vaultSigner);
        vault.pay(LANDLORD, address(usd), 1e6, D1);
        assertEq(usd.balanceOf(landlord), 1e6);
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

    // =================================================================== M-8: the MEMORY permission

    /// This deployment's agent-lane key registered as agent `me`, and the anchor linked to it.
    function _linkMemoryGate(uint32 perms) internal returns (uint256 me) {
        me = _register(owner, agentPk, "this deployment", 0, perms, 1e6, 1e6, false);
        vm.prank(owner);
        anchorC.linkAgent(agents, me);
    }

    function _anchorAgentMemory(bytes16 id) internal {
        MemoryAnchor.Memory memory m = _mem(id, 2);
        bytes memory sig = _signMem(agentPk, m);
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafycid");
    }

    function test_memoryGateNeedsTheMemoryPermission() public {
        _anchorAgentMemory(bytes16(uint128(1))); // not linked: lane rules only
        uint256 me = _linkMemoryGate(PAY | MEM);
        assertEq(address(anchorC.agentRegistry()), address(agents));
        assertEq(anchorC.agentId(), me);
        _anchorAgentMemory(bytes16(uint128(2)));

        vm.prank(owner);
        agents.setPermissions(me, PAY);
        MemoryAnchor.Memory memory m = _mem(bytes16(uint128(3)), 2);
        bytes memory sig = _signMem(agentPk, m);
        vm.expectRevert(MemoryAnchor.NoMemoryPermission.selector);
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafycid");

        // other lanes are never gated
        MemoryAnchor.Memory memory u = _mem(bytes16(uint128(4)), 1);
        bytes memory usig = _signMem(userPk, u);
        vm.prank(submitter);
        anchorC.anchor(u, usig, "bafycid");
    }

    function test_memoryGateStopsAFrozenOrMismatchedAgent() public {
        _linkMemoryGate(ALL);
        vm.prank(owner);
        agents.freeze(true);
        MemoryAnchor.Memory memory m = _mem(bytes16(uint128(5)), 2);
        bytes memory sig = _signMem(agentPk, m);
        vm.expectRevert(abi.encodeWithSelector(MemoryAnchor.AgentBlocked.selector, bytes32("HUMAN_FROZEN")));
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafycid");
        vm.prank(owner);
        agents.freeze(false);

        vm.prank(owner);
        anchorC.linkAgent(agents, a1); // a1's key is not this deployment's agent-lane key
        vm.expectRevert(MemoryAnchor.AgentKeyMismatch.selector);
        vm.prank(submitter);
        anchorC.anchor(m, sig, "bafycid");

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vm.prank(attacker);
        anchorC.linkAgent(IAgentRegistry(address(0)), 0);
        vm.prank(owner);
        anchorC.linkAgent(IAgentRegistry(address(0)), a1); // unlink
        assertEq(anchorC.agentId(), 0);
        _anchorAgentMemory(bytes16(uint128(5)));
    }
}
