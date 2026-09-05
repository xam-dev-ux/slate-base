// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {SlateFactory} from "../src/SlateFactory.sol";
import {SlateFund} from "../src/SlateFund.sol";
import {SlateAddresses} from "./SlateAddresses.sol";

/// @notice Deploys the curated funds through an existing `SlateFactory`. The broadcasting account
///         becomes each fund's operator — which grants only the bounded powers (pause deposits,
///         tune parameters within hard limits) and never any ability to move user funds.
///
///         FACTORY_ADDRESS=0x... base-forge script script/DeployFunds.s.sol \
///           --rpc-url https://mainnet.base.org --account speedrun --broadcast --verify -vv
contract DeployFunds is Script {
    address internal constant DEPLOYER = 0x8F058fE6b568D97f85d517Ac441b52B95722fDDe;

    function run() external returns (address bigTech4, address aiCore) {
        SlateFactory factory = SlateFactory(vm.envAddress("FACTORY_ADDRESS"));
        console.log("Factory:", address(factory));
        console.log("Operator (deployer):", DEPLOYER);

        vm.startBroadcast();

        bigTech4 = factory.createFund(
            keccak256("slate.big-tech-4.v1"),
            "Slate Big Tech 4",
            "SLATE4",
            SlateAddresses.bigTech4(),
            SlateAddresses.BIG_TECH_4_RULE
        );

        aiCore = factory.createFund(
            keccak256("slate.ai-core.v1"),
            "Slate AI Core",
            "SLATEAI",
            SlateAddresses.aiCore(),
            SlateAddresses.AI_CORE_RULE
        );

        vm.stopBroadcast();

        console.log("");
        console.log("Slate Big Tech 4:", bigTech4);
        console.log("  share token:", address(SlateFund(bigTech4).SHARE()));
        console.log("Slate AI Core:  ", aiCore);
        console.log("  share token:", address(SlateFund(aiCore).SHARE()));
        console.log("");
        console.log("Record these in SUBMISSION.md and the frontend env.");
    }
}
