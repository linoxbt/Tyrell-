// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AgentsBase} from "./AgentsBase.t.sol";
import {AgentNetwork} from "../src/AgentNetwork.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Phase B: bonds, reports, disputes, penalties, appeals, reputation, A2A messages and deals.
contract NetworkTest is AgentsBase {
    // =================================================================== setup and admin

    function test_constructorRejectsBadParams() public {
        AgentNetwork.Params memory p = _params();
        p.minBond = 0;
        vm.expectRevert(AgentNetwork.BadParams.selector);
        new AgentNetwork(agents, IERC20(address(usd)), council, p);
        p = _params();
        p.slashBps = 10_001;
        vm.expectRevert(AgentNetwork.BadParams.selector);
        new AgentNetwork(agents, IERC20(address(usd)), council, p);
        p = _params();
        p.arbiter = address(0);
        vm.expectRevert(AgentNetwork.BadParams.selector);
        new AgentNetwork(agents, IERC20(address(usd)), council, p);
        p = _params();
        p.ruleWindow = 0;
        vm.expectRevert(AgentNetwork.BadParams.selector);
        new AgentNetwork(agents, IERC20(address(usd)), council, p);
    }

    /// S-10: the council replaces the arbiter, and can never leave the network ownerless.
    function test_arbiterRotationAndNoRenounce() public {
        address next = makeAddr("next-arbiter");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, arbiter));
        vm.prank(arbiter);
        net.setArbiter(next);
        vm.expectRevert(AgentNetwork.BadParams.selector);
        vm.prank(council);
        net.setArbiter(address(0));
        vm.expectEmit(true, true, false, false, address(net));
        emit AgentNetwork.ArbiterChanged(arbiter, next);
        vm.prank(council);
        net.setArbiter(next);
        assertEq(net.arbiter(), next);
        vm.expectRevert(AgentNetwork.NoRenounce.selector);
        vm.prank(council);
        net.renounceOwnership();
        assertEq(net.owner(), council);
    }

    // =================================================================== bonds (S-9: two-step withdrawal)

    function test_bondAndTwoStepWithdraw() public {
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
        net.requestWithdrawal(a1, 1e6);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.BelowMinBond.selector, a1));
        vm.prank(owner);
        net.requestWithdrawal(a1, 6e6); // would leave 9 < 10
        vm.expectRevert(AgentNetwork.BadAmount.selector);
        vm.prank(owner);
        net.requestWithdrawal(a1, 16e6);
        vm.expectRevert(AgentNetwork.NoWithdrawal.selector);
        vm.prank(owner);
        net.withdrawBond(a1);

        vm.prank(owner);
        net.requestWithdrawal(a1, 15e6); // leave the network entirely
        assertFalse(net.isBonded(a1)); // a bond on its way out no longer counts
        assertEq(net.effectiveBond(a1), 0);
        vm.expectRevert(AgentNetwork.WithdrawalNotReady.selector);
        vm.prank(owner);
        net.withdrawBond(a1);

        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, a1));
        vm.prank(bob);
        net.cancelWithdrawal(a1);
        vm.prank(owner);
        net.cancelWithdrawal(a1);
        assertTrue(net.isBonded(a1));
        vm.expectRevert(AgentNetwork.NoWithdrawal.selector);
        vm.prank(owner);
        net.cancelWithdrawal(a1);

        vm.prank(owner);
        net.requestWithdrawal(a1, 5e6);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, a1));
        vm.prank(bob);
        net.withdrawBond(a1);
        uint256 before = usd.balanceOf(owner);
        vm.prank(owner);
        net.withdrawBond(a1);
        assertEq(usd.balanceOf(owner), before + 5e6);
        assertEq(net.bondOf(a1), 10e6);
    }

    /// S-9: misbehave, then try to run with the bond: a report filed during the delay still slashes it.
    function test_cannotDodgeASlashByWithdrawing() public {
        vm.prank(bob);
        net.bond(b1, 20e6);
        vm.prank(bob);
        net.requestWithdrawal(b1, 20e6);
        uint256 r = _report(carol, b1);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.OpenReports.selector, b1));
        vm.prank(bob);
        net.withdrawBond(b1);
        vm.prank(bob);
        net.contest(r);
        vm.prank(arbiter);
        net.resolve(r, true); // slashes 20% of the full bond, pending withdrawal included
        assertEq(net.bondOf(b1), 16e6);
        uint256 before = usd.balanceOf(bob);
        vm.prank(bob);
        net.withdrawBond(b1); // what is left of the request
        assertEq(usd.balanceOf(bob), before + 16e6);
        assertEq(net.bondOf(b1), 0);
    }

    // =================================================================== reports (S-2) and disputes (S-10)

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
        assertEq(net.reportCount(), 0);
    }

    /// S-2: an uncontested report earns the reporter nothing beyond their own bond, slashes nothing, bans nothing.
    function test_uncontestedReportOnlyRefundsTheReporter() public {
        vm.prank(bob);
        net.bond(b1, 20e6);
        uint256 carolBefore = usd.balanceOf(carol);
        uint256 r = _report(carol, b1);
        assertEq(net.openReports(b1), 1);
        assertEq(net.openReportsBy(carol), 1);
        vm.expectRevert(AgentNetwork.WindowOpen.selector);
        net.finalize(r);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectEmit(true, true, false, false, address(net));
        emit AgentNetwork.ReportUncontested(r, b1);
        net.finalize(r);
        assertEq(net.bondOf(b1), 20e6); // nothing slashed
        assertEq(usd.balanceOf(carol), carolBefore); // bond back, no profit
        assertEq(net.record(b1).reportsUncontested, 1);
        assertEq(net.record(b1).reportsUpheld, 0);
        assertEq(net.openReports(b1), 0);
        assertEq(net.openReportsBy(carol), 0);
        assertEq(uint8(net.report(r).status), uint8(AgentNetwork.ReportStatus.Uncontested));
        vm.expectRevert(AgentNetwork.WrongStatus.selector);
        net.finalize(r);
    }

    /// S-2: no free permanent bans. Any number of uncontested reports never ban an agent.
    function test_uncontestedReportsNeverBan() public {
        address[3] memory reporters = [carol, dave, owner];
        for (uint256 i; i < 3; ++i) {
            uint256 r = _report(reporters[i], b1);
            vm.warp(block.timestamp + WINDOW + 1);
            net.finalize(r);
        }
        (bool ok,) = agents.status(b1);
        assertTrue(ok);
        assertFalse(agents.banned(b1));
        assertEq(net.reputation(b1), 350); // 500 - 3 x 50
    }

    /// S-2: report spam is bounded: one open report per agent per reporter, a cooldown, and a cap per reporter.
    function test_reportLimits() public {
        uint256 r = _report(carol, b1);
        vm.expectRevert(AgentNetwork.AlreadyReported.selector);
        vm.prank(carol);
        net.fileReport(b1, 1, bytes32("again"), "");
        vm.warp(block.timestamp + WINDOW + 1);
        net.finalize(r);
        vm.expectRevert(AgentNetwork.ReportCooldown.selector);
        vm.prank(carol);
        net.fileReport(b1, 1, bytes32("again"), "");
        vm.warp(block.timestamp + WINDOW);
        _report(carol, b1); // after the cooldown

        // the cap on open reports per reporter
        for (uint256 i = 1; i < net.MAX_OPEN_PER_REPORTER(); ++i) {
            uint256 pk = 0x5000 + i;
            uint256 id = _register(bob, pk, "spare", 0, ALL, 1, 1, true);
            _report(carol, id);
        }
        uint256 extra = _register(bob, 0x5999, "spare", 0, ALL, 1, 1, true);
        vm.expectRevert(AgentNetwork.TooManyOpenReports.selector);
        vm.prank(carol);
        net.fileReport(extra, 1, bytes32("e"), "");
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
        vm.expectEmit(true, true, false, true, address(net));
        emit AgentNetwork.ReportUpheld(r, b1, 4e6, false); // 20% of 20
        vm.prank(arbiter);
        net.resolve(r, true);
        // carol: her bond + bob's contest bond + the 20% slash
        assertEq(usd.balanceOf(carol), carolBefore + REPORT_BOND * 2 + 4e6);
        assertEq(net.bondOf(b1), 16e6);
        assertEq(net.record(b1).reportsUpheld, 1);
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

    /// S-10: an idle arbiter can't lock bonds forever: after the ruling window the report lapses, both refunded.
    function test_contestedReportLapsesWithoutARuling() public {
        vm.prank(bob);
        net.bond(b1, 20e6);
        uint256 r = _report(carol, b1);
        vm.prank(bob);
        net.contest(r);
        vm.expectRevert(AgentNetwork.WindowOpen.selector);
        net.lapse(r);
        vm.warp(block.timestamp + RULE + 1);
        vm.expectRevert(AgentNetwork.WindowClosed.selector);
        vm.prank(arbiter);
        net.resolve(r, true);
        uint256 carolBefore = usd.balanceOf(carol);
        uint256 bobBefore = usd.balanceOf(bob);
        vm.expectEmit(true, true, false, false, address(net));
        emit AgentNetwork.ReportLapsed(r, b1);
        net.lapse(r);
        assertEq(usd.balanceOf(carol), carolBefore + REPORT_BOND);
        assertEq(usd.balanceOf(bob), bobBefore + REPORT_BOND);
        assertEq(net.bondOf(b1), 20e6);
        assertEq(net.openReports(b1), 0);
        assertEq(uint8(net.report(r).status), uint8(AgentNetwork.ReportStatus.Lapsed));
        vm.expectRevert(AgentNetwork.WrongStatus.selector);
        net.lapse(r);
    }

    /// S-10: the arbiter never rules on a report they filed, or on their own agent.
    function test_arbiterCannotJudgeTheirOwnCase() public {
        _bind(arbiter, "arbiter.qie");
        vm.prank(owner);
        usd.mint(arbiter, 10e6);
        vm.prank(arbiter);
        usd.approve(address(net), type(uint256).max);
        uint256 r = _report(arbiter, b1);
        vm.prank(bob);
        net.contest(r);
        vm.expectRevert(AgentNetwork.ArbiterConflict.selector);
        vm.prank(arbiter);
        net.resolve(r, true);

        (, uint256 pk) = makeAddrAndKey("arbiter-agent");
        uint256 own = _register(arbiter, pk, "arbiter's agent", 0, ALL, 1, 1, true);
        uint256 r2 = _report(carol, own);
        vm.prank(arbiter);
        net.contest(r2);
        vm.expectRevert(AgentNetwork.ArbiterConflict.selector);
        vm.prank(arbiter);
        net.resolve(r2, false);
    }

    function _upheld(address reporter, uint256 agentId) internal {
        uint256 r = _report(reporter, agentId);
        vm.prank(agents.humanOf(agentId));
        net.contest(r);
        vm.prank(arbiter);
        net.resolve(r, true);
    }

    /// Only the arbiter's rulings ban; the human can appeal and the arbiter can lift the ban.
    function test_threeUpheldRulingsBanAndAnAppealLiftsIt() public {
        vm.prank(bob);
        net.bond(b1, 20e6);
        vm.expectRevert(AgentNetwork.NotBanned.selector);
        vm.prank(bob);
        net.appeal(b1, "ipfs://appeal");
        _upheld(carol, b1);
        _upheld(dave, b1);
        _upheld(owner, b1);
        assertTrue(agents.banned(b1));
        (bool ok, bytes32 code) = agents.status(b1);
        assertFalse(ok);
        assertEq(code, "AGENT_BANNED");
        assertEq(net.reputation(b1), 0);

        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, b1));
        vm.prank(carol);
        net.appeal(b1, "x");
        vm.expectEmit(true, true, false, true, address(net));
        emit AgentNetwork.BanAppealed(b1, bob, "ipfs://appeal");
        vm.prank(bob);
        net.appeal(b1, "ipfs://appeal");
        vm.expectRevert(AgentNetwork.OnlyArbiter.selector);
        vm.prank(bob);
        net.unban(b1, "granted");
        vm.prank(arbiter);
        net.unban(b1, "granted on appeal");
        (ok,) = agents.status(b1);
        assertTrue(ok);
        assertEq(net.record(b1).reportsUpheld, 0);
        vm.expectRevert(AgentNetwork.NotBanned.selector);
        vm.prank(arbiter);
        net.unban(b1, "again");
    }

    function test_arbiterCannotUnbanTheirOwnAgent() public {
        _bind(arbiter, "arbiter.qie");
        (, uint256 pk) = makeAddrAndKey("arbiter-agent");
        uint256 own = _register(arbiter, pk, "arbiter's agent", 0, ALL, 1, 1, true);
        vm.prank(address(net));
        agents.ban(own);
        vm.expectRevert(AgentNetwork.ArbiterConflict.selector);
        vm.prank(arbiter);
        net.unban(own, "self");
    }

    // =================================================================== reputation

    function test_reputationReflectsHistory() public {
        assertEq(net.reputation(b1), 500);
        vm.prank(bob);
        net.bond(b1, 30e6); // 3 x minBond -> +60
        assertEq(net.reputation(b1), 560);
        vm.prank(bob);
        net.bond(b1, 50e6); // 8 x minBond: capped at +100
        assertEq(net.reputation(b1), 600);
        _upheld(carol, b1); // -150; the bond shrinks by 20% (64 = 6 x minBond, still capped at +100)
        assertEq(net.reputation(b1), 450);
        assertEq(net.reputation(999), 0);
        uint256[] memory ids = new uint256[](2);
        ids[0] = b1;
        ids[1] = a1;
        (uint256[] memory bonds, uint256[] memory pending, uint256[] memory reps) = net.stats(ids);
        assertEq(bonds[0], 64e6);
        assertEq(pending[0], 0);
        assertEq(reps[0], 450);
        assertEq(bonds[1], 0);
        assertEq(reps[1], 500);
        // a withdrawal waiting to leave no longer counts as bond (as isBonded and reputation see it)
        vm.prank(bob);
        net.requestWithdrawal(b1, 54e6);
        (bonds, pending,) = net.stats(ids);
        assertEq(bonds[0], 10e6);
        assertEq(pending[0], 54e6);
        assertEq(bonds[0], net.effectiveBond(b1));
    }

    // =================================================================== agent-to-agent messages

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

    /// M-8: a message the recipient acted on can't be replayed.
    function test_acceptedMessagesCannotBeReplayed() public {
        uint64 dl = uint64(block.timestamp + 1 hours);
        vm.prank(owner);
        net.bond(a1, MIN_BOND);
        bytes memory sig = _msgSig(a1Pk, a1, b1, bytes32("hello"), 7, dl);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, b1));
        vm.prank(carol);
        net.acceptMessage(a1, b1, bytes32("hello"), 7, dl, sig);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.MessageRejected.selector, bytes32("BAD_SIGNATURE")));
        vm.prank(bob);
        net.acceptMessage(a1, b1, bytes32("other"), 7, dl, sig);
        vm.expectEmit(true, true, false, true, address(net));
        emit AgentNetwork.MessageAccepted(a1, b1, 7, bytes32("hello"));
        vm.prank(b1Key); // the receiving agent's own key may record it too
        net.acceptMessage(a1, b1, bytes32("hello"), 7, dl, sig);
        assertTrue(net.messageUsed(a1, 7));
        (bool ok, bytes32 code) = net.verifyMessage(a1, b1, bytes32("hello"), 7, dl, sig);
        assertFalse(ok);
        assertEq(code, "NONCE_USED");
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.MessageRejected.selector, bytes32("NONCE_USED")));
        vm.prank(bob);
        net.acceptMessage(a1, b1, bytes32("hello"), 7, dl, sig);
    }

    // =================================================================== agent-to-agent deals

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

    /// M-8: cancelled and reclaimed deals give the paying agent's quota back.
    function test_dealCancelAndReclaimRefundTheQuota() public {
        _bondBoth();
        uint256 ownerBefore = usd.balanceOf(owner);
        uint256 d = _openDeal(2e6);
        assertEq(agents.spentToday(a1, address(usd)), 2e6);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, b1));
        vm.prank(owner);
        net.cancelDeal(d);
        vm.prank(bob);
        net.cancelDeal(d);
        assertEq(usd.balanceOf(owner), ownerBefore);
        assertEq(agents.spentToday(a1, address(usd)), 0);
        assertEq(agents.humanSpentToday(owner, address(usd)), 0);

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
        assertEq(uint8(net.deal(d2).status), uint8(AgentNetwork.DealStatus.Reclaimed));
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.UnknownDeal.selector, 9));
        net.deal(9);
    }

    /// A refund never gets stuck: even if the payer stopped authorising the network as a spender while the
    /// deal was open, cancelling or reclaiming still refunds the escrow and the quota.
    function test_dealRefundsSurviveSpenderRemoval() public {
        _bondBoth();
        uint256 day0 = block.timestamp / 1 days;
        uint256 ownerBefore = usd.balanceOf(owner);
        uint256 d = _openDeal(2e6);
        uint256 d2 = _openDeal(1e6);
        vm.prank(owner);
        agents.setSpender(address(net), false);
        vm.prank(bob);
        net.cancelDeal(d);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(owner);
        net.reclaim(d2);
        assertEq(usd.balanceOf(owner), ownerBefore);
        assertEq(agents.chargedBy(a1, day0, address(net)), 0);
    }

    /// M-8: deals need DEAL permission, not PAY.
    function test_dealsNeedDealNotPay() public {
        _bondBoth();
        vm.prank(owner);
        agents.setPermissions(a1, DEAL); // may deal, may not pay landlords
        assertEq(_code(a1, 1e6), "NOT_PERMITTED");
        uint256 d = _openDeal(1e6);
        assertEq(uint8(net.deal(d).status), uint8(AgentNetwork.DealStatus.Open));
        vm.prank(owner);
        agents.setPermissions(a1, PAY);
        vm.expectRevert(abi.encodeWithSelector(IAgentRegistry.AgentBlocked.selector, bytes32("NOT_PERMITTED")));
        _openDeal(1e6);
    }

    /// M-8: a payee who delivered can't be stiffed by a payer who waits out the deadline.
    function test_deliveredDealProtectsThePayee() public {
        _bondBoth();
        uint256 d = _openDeal(3e6);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, b1));
        vm.prank(owner);
        net.deliver(d);
        vm.prank(bob);
        net.deliver(d);
        vm.expectRevert(AgentNetwork.WrongStatus.selector);
        vm.prank(bob);
        net.deliver(d);
        vm.warp(block.timestamp + 1 days + 1); // past the deadline
        vm.expectRevert(AgentNetwork.WrongStatus.selector);
        vm.prank(owner);
        net.reclaim(d); // no longer possible once delivered
        vm.expectRevert(AgentNetwork.WindowOpen.selector);
        vm.prank(bob);
        net.claim(d);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(AgentNetwork.WindowClosed.selector);
        vm.prank(owner);
        net.disputeDeal(d);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, b1));
        vm.prank(owner);
        net.claim(d);
        uint256 bobBefore = usd.balanceOf(bob);
        vm.prank(bob);
        net.claim(d);
        assertEq(usd.balanceOf(bob), bobBefore + 3e6);
        assertEq(net.record(b1).dealsCompleted, 1);
    }

    function test_deliverAfterTheDeadlineIsRefused() public {
        _bondBoth();
        uint256 d = _openDeal(1e6);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(AgentNetwork.DeadlinePassed.selector);
        vm.prank(bob);
        net.deliver(d);
    }

    function test_disputedDealArbiterDecides() public {
        _bondBoth();
        uint256 d = _openDeal(2e6);
        vm.expectRevert(AgentNetwork.WrongStatus.selector);
        vm.prank(owner);
        net.disputeDeal(d); // not delivered yet
        vm.prank(bob);
        net.deliver(d);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotHumanOf.selector, a1));
        vm.prank(bob);
        net.disputeDeal(d);
        vm.prank(owner);
        net.disputeDeal(d);
        vm.expectRevert(AgentNetwork.OnlyArbiter.selector);
        vm.prank(bob);
        net.resolveDeal(d, true);
        uint256 bobBefore = usd.balanceOf(bob);
        vm.prank(arbiter);
        net.resolveDeal(d, true);
        assertEq(usd.balanceOf(bob), bobBefore + 2e6);

        uint256 d2 = _openDeal(1e6);
        vm.prank(bob);
        net.deliver(d2);
        vm.prank(owner);
        net.disputeDeal(d2);
        uint256 ownerBefore = usd.balanceOf(owner);
        vm.prank(arbiter);
        net.resolveDeal(d2, false);
        assertEq(usd.balanceOf(owner), ownerBefore + 1e6);
        assertEq(uint8(net.deal(d2).status), uint8(AgentNetwork.DealStatus.Refunded));
        vm.expectRevert(AgentNetwork.WrongStatus.selector);
        vm.prank(arbiter);
        net.resolveDeal(d2, true);
    }

    function test_disputedDealLapsesToThePayer() public {
        _bondBoth();
        uint256 d = _openDeal(2e6);
        vm.prank(bob);
        net.deliver(d);
        vm.prank(owner);
        net.disputeDeal(d);
        vm.expectRevert(AgentNetwork.WindowOpen.selector);
        net.lapseDeal(d);
        vm.warp(block.timestamp + RULE + 1);
        vm.expectRevert(AgentNetwork.WindowClosed.selector);
        vm.prank(arbiter);
        net.resolveDeal(d, true);
        uint256 ownerBefore = usd.balanceOf(owner);
        net.lapseDeal(d);
        assertEq(usd.balanceOf(owner), ownerBefore + 2e6);
        vm.expectRevert(AgentNetwork.WrongStatus.selector);
        net.lapseDeal(d);
    }

    function test_arbiterCannotDecideTheirOwnDeal() public {
        _bind(arbiter, "arbiter.qie");
        (, uint256 pk) = makeAddrAndKey("arbiter-agent");
        uint256 own = _register(arbiter, pk, "arbiter's shop", 0, ALL, 1e6, 1e6, true);
        vm.prank(owner);
        usd.mint(arbiter, 20e6);
        vm.startPrank(arbiter);
        usd.approve(address(net), type(uint256).max);
        net.bond(own, MIN_BOND);
        vm.stopPrank();
        vm.prank(owner);
        net.bond(a1, MIN_BOND);
        vm.prank(owner);
        agents.setAnyPayee(a1, true);
        vm.prank(owner);
        uint256 d = net.openDeal(a1, own, address(usd), 1e6, 0, uint64(block.timestamp + 1 days));
        vm.prank(arbiter);
        net.deliver(d);
        vm.prank(owner);
        net.disputeDeal(d);
        vm.expectRevert(AgentNetwork.ArbiterConflict.selector);
        vm.prank(arbiter);
        net.resolveDeal(d, true);
        // the payee can still back out: the payer is refunded
        uint256 ownerBefore = usd.balanceOf(owner);
        vm.prank(arbiter);
        net.cancelDeal(d);
        assertEq(usd.balanceOf(owner), ownerBefore + 1e6);
        assertEq(uint8(net.deal(d).status), uint8(AgentNetwork.DealStatus.Cancelled));
    }

    function test_dealRules() public {
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotBonded.selector, a1));
        _openDeal(1e6);
        vm.prank(owner);
        net.bond(a1, MIN_BOND);
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.NotBonded.selector, b1));
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
        vm.prank(bob);
        agents.revokeAgent(b1, "gone");
        vm.expectRevert(abi.encodeWithSelector(AgentNetwork.AgentNotActive.selector, b1, bytes32("AGENT_REVOKED")));
        _openDeal(1e6);
    }
}
