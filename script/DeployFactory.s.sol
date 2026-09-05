// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {SlateFactory} from "../src/SlateFactory.sol";
import {SlateAddresses} from "./SlateAddresses.sol";

/// @notice Deploys the permissionless `SlateFactory`.
///
///         base-forge script script/DeployFactory.s.sol \
///           --rpc-url https://mainnet.base.org --account speedrun --broadcast --verify -vv
contract DeployFactory is Script {
    /// @dev Hardcoded rather than read from `msg.sender`, which is not meaningful before broadcast.
    address internal constant DEPLOYER = 0x8F058fE6b568D97f85d517Ac441b52B95722fDDe;

    function run() external returns (address factory) {
        console.log("Deployer:", DEPLOYER);
        console.log("USDC:", SlateAddresses.USDC);
        console.log("Swap router (0x AllowanceHolder):", SlateAddresses.ZEROX_ALLOWANCE_HOLDER);

        vm.startBroadcast();
        SlateFactory deployed = new SlateFactory(SlateAddresses.USDC, SlateAddresses.ZEROX_ALLOWANCE_HOLDER);
        vm.stopBroadcast();

        factory = address(deployed);
        console.log("");
        console.log("SlateFactory deployed at:", factory);
        console.log("Set NEXT_PUBLIC_FACTORY_ADDRESS to this value.");
    }
}
