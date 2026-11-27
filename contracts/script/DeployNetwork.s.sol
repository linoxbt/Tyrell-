// SPDX-License-Identifier: Apache-2.0
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
///      Env: BOND_TOKEN (QUSDC on mainnet), ARBITER (a council multisig), and optionally QIE_ID, MIN_BOND,
///      REPORT_BOND (base units), CONTEST_WINDOW (seconds), SLASH_BPS, BAN_AFTER.
contract DeployNetwork is Script {
    uint256 internal constant QIE_MAINNET = 1990;
    address internal constant QIE_ID_MAINNET = 0x8777d01d509D0eA71FB38F88F79867da558d5018;

    function run() external returns (AgentRegistry registry, AgentNetwork network, address qieId) {
        address bondToken = vm.envAddress("BOND_TOKEN");
        address arbiter = vm.envAddress("ARBITER");
        qieId = vm.envOr("QIE_ID", block.chainid == QIE_MAINNET ? QIE_ID_MAINNET : address(0));
        uint256 minBond = vm.envOr("MIN_BOND", uint256(10e6));
        uint256 reportBond = vm.envOr("REPORT_BOND", uint256(2e6));
        uint64 window = uint64(vm.envOr("CONTEST_WINDOW", uint256(3 days)));
        uint16 slashBps = uint16(vm.envOr("SLASH_BPS", uint256(2_000)));
        uint8 banAfter = uint8(vm.envOr("BAN_AFTER", uint256(3)));
        require(bondToken != address(0) && arbiter != address(0), "BOND_TOKEN and ARBITER required");

        uint256 startBlock = block.number;
        vm.startBroadcast();
        if (qieId == address(0)) qieId = address(new TestQieId());
        registry = new AgentRegistry(IQieId(qieId));
        network = new AgentNetwork(registry, IERC20(bondToken), arbiter, minBond, reportBond, window, slashBps, banAfter);
        registry.setNetwork(address(network));
        vm.stopBroadcast();

        string memory k = "network";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", startBlock);
        vm.serializeAddress(k, "qieId", qieId);
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
