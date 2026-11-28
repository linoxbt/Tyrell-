// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {LaneRegistry} from "../src/LaneRegistry.sol";
import {MemoryAnchor} from "../src/MemoryAnchor.sol";
import {TyrellLedger} from "../src/TyrellLedger.sol";
import {GuardedVault} from "../src/GuardedVault.sol";
import {TyrellTestUSD} from "../src/TyrellTestUSD.sol";

/// @notice Deploys LaneRegistry, MemoryAnchor, TyrellLedger and GuardedVault (FR-01).
/// @dev The broadcasting key is a throwaway deployer: it holds no role afterwards. Every privileged
///      role goes to OWNER (the human's QIE Wallet address) at construction, so nothing needs handing
///      over. After deploy, the owner registers lane keys and sets the vault's global daily cap from
///      QIE Wallet (`tyrell setup`, Phase 3).
///
///      Env: OWNER, SUBMITTER (control gas key), VAULT_SIGNER, TYRELL_ACCT (bytes32), TOKEN (optional:
///      on QIE mainnet it defaults to, and must equal, QUSDC; unset elsewhere deploys TyrellTestUSD).
///      The control lane key needs no role here: the vault lets whichever key is the active control-lane
///      key pause it, so rotating that key needs no vault change.
///
///      forge script script/Deploy.s.sol --rpc-url qie_testnet --broadcast --account <deployer> \
///        --verify --verifier blockscout --verifier-url https://testnet.qie.digital/api/
contract Deploy is Script {
    uint256 internal constant QIE_MAINNET = 1990;
    /// @dev QUSDC on QIE mainnet (packages/chain QUSDC_MAINNET). A mainnet deploy refuses any other token.
    address internal constant QUSDC_MAINNET = 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5;

    struct Deployment {
        LaneRegistry registry;
        MemoryAnchor anchor;
        TyrellLedger ledger;
        GuardedVault vault;
        address token;
        uint256 startBlock;
    }

    function run() external returns (Deployment memory d) {
        address owner = vm.envAddress("OWNER");
        address submitter = vm.envAddress("SUBMITTER");
        address vaultSigner = vm.envAddress("VAULT_SIGNER");
        bytes32 acct = vm.envBytes32("TYRELL_ACCT");
        address token = vm.envOr("TOKEN", block.chainid == QIE_MAINNET ? QUSDC_MAINNET : address(0));
        require(owner != address(0) && submitter != address(0) && vaultSigner != address(0), "zero role");
        require(acct != bytes32(0), "TYRELL_ACCT unset");
        require(block.chainid != QIE_MAINNET || token == QUSDC_MAINNET, "on QIE mainnet TOKEN must be QUSDC");

        d.startBlock = block.number;
        vm.startBroadcast();
        d.registry = new LaneRegistry(owner);
        d.anchor = new MemoryAnchor(owner, d.registry, acct, submitter);
        d.ledger = new TyrellLedger(d.registry);
        d.vault = new GuardedVault(owner, d.ledger, vaultSigner, address(0));
        d.token = token != address(0) ? token : address(new TyrellTestUSD(owner));
        vm.stopBroadcast();

        _write(d, owner, acct, token == address(0));
    }

    function _write(Deployment memory d, address owner, bytes32 acct, bool testToken) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", d.startBlock);
        vm.serializeAddress(k, "owner", owner);
        vm.serializeBytes32(k, "acct", acct);
        vm.serializeAddress(k, "laneRegistry", address(d.registry));
        vm.serializeAddress(k, "memoryAnchor", address(d.anchor));
        vm.serializeAddress(k, "tyrellLedger", address(d.ledger));
        vm.serializeAddress(k, "guardedVault", address(d.vault));
        vm.serializeBool(k, "testToken", testToken);
        string memory json = vm.serializeAddress(k, "token", d.token);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("Wrote", path);
        console2.log("LaneRegistry ", address(d.registry));
        console2.log("MemoryAnchor ", address(d.anchor));
        console2.log("TyrellLedger ", address(d.ledger));
        console2.log("GuardedVault ", address(d.vault));
        console2.log("Token        ", d.token);
    }
}
