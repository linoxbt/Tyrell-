// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AgentNetwork} from "../src/AgentNetwork.sol";
import {TestQieId} from "../src/TestQieId.sol";
import {IQieId} from "../src/interfaces/IQieId.sol";

/// @notice Deploys the agents network once per chain: AgentRegistry (phase A) and AgentNetwork (phase B),
///         and links them. Every human's Tyrell deployment then points at these two contracts.
/// @dev    On QIE mainnet the registry verifies names against the real QIE ID record store
///         (0x8777d01d509D0eA71FB38F88F79867da558d5018). QIE ID is not deployed on testnet, so elsewhere a
///         TestQieId is deployed unless QIE_ID is given.
///
///      Env: BOND_TOKEN (QUSDC on mainnet: defaults to it there and must equal it), ARBITER (decides contested
///      reports and disputed deals), ADMIN (a council multisig that can replace the arbiter; required on
///      mainnet, defaults to ARBITER elsewhere), and optionally QIE_ID (must be the real store on mainnet),
///      MIN_BOND, REPORT_BOND (base units), CONTEST_WINDOW and RULE_WINDOW (seconds), SLASH_BPS, BAN_AFTER.
contract DeployNetwork is Script {
    uint256 internal constant QIE_MAINNET = 1990;
    address internal constant QIE_ID_MAINNET = 0x8777d01d509D0eA71FB38F88F79867da558d5018;
    address internal constant QUSDC_MAINNET = 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5;

    function run() external returns (AgentRegistry registry, AgentNetwork network, address qieId) {
        bool mainnet = block.chainid == QIE_MAINNET;
        address bondToken = vm.envOr("BOND_TOKEN", mainnet ? QUSDC_MAINNET : address(0));
        AgentNetwork.Params memory p;
        p.arbiter = vm.envAddress("ARBITER");
        address admin = mainnet ? vm.envAddress("ADMIN") : vm.envOr("ADMIN", p.arbiter);
        qieId = vm.envOr("QIE_ID", mainnet ? QIE_ID_MAINNET : address(0));
        p.minBond = vm.envOr("MIN_BOND", uint256(10e6));
        p.reportBond = vm.envOr("REPORT_BOND", uint256(2e6));
        p.contestWindow = uint64(vm.envOr("CONTEST_WINDOW", uint256(3 days)));
        p.ruleWindow = uint64(vm.envOr("RULE_WINDOW", uint256(7 days)));
        p.slashBps = uint16(vm.envOr("SLASH_BPS", uint256(2_000)));
        p.banAfter = uint8(vm.envOr("BAN_AFTER", uint256(3)));
        require(bondToken != address(0) && p.arbiter != address(0) && admin != address(0), "BOND_TOKEN, ARBITER and ADMIN required");
        require(!mainnet || (bondToken == QUSDC_MAINNET && qieId == QIE_ID_MAINNET), "on QIE mainnet: QUSDC bonds and the real QIE ID store only");

        uint256 startBlock = block.number;
        vm.startBroadcast();
        if (qieId == address(0)) qieId = address(new TestQieId());
        registry = new AgentRegistry(IQieId(qieId));
        network = new AgentNetwork(registry, IERC20(bondToken), admin, p);
        registry.setNetwork(address(network));
        vm.stopBroadcast();

        string memory k = "network";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", startBlock);
        vm.serializeAddress(k, "qieId", qieId);
        vm.serializeAddress(k, "admin", admin);
        vm.serializeAddress(k, "arbiter", p.arbiter);
        vm.serializeBool(k, "testQieId", block.chainid != QIE_MAINNET && qieId != QIE_ID_MAINNET);
        vm.serializeAddress(k, "agentRegistry", address(registry));
        string memory json = vm.serializeAddress(k, "agentNetwork", address(network));
        string memory path = string.concat(vm.projectRoot(), "/deployments/network-", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("Wrote", path);
        console2.log("QIE ID store  ", qieId);
        console2.log("AgentRegistry ", address(registry));
        console2.log("AgentNetwork  ", address(network));
    }
}
