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

    /// @dev Where the protocol fee (see PROTOCOL_FEE_BPS) accrues, across every fund this factory
    ///      ever deploys — including ones a third party deploys through it, since the factory is
    ///      permissionless. Deliberately the deployer's own address, not settable per-fund.
    address internal constant PROTOCOL_FEE_RECIPIENT = DEPLOYER;

    /// @dev 0 until deliberately set otherwise — a live protocol fee is a business decision that
    ///      shouldn't default itself on in a deploy script. Bounded to 100 (1%) by SlateFund's own
    ///      constructor regardless of what's written here.
    uint16 internal constant PROTOCOL_FEE_BPS = 0;

    function run() external returns (address factory) {
        console.log("Deployer:", DEPLOYER);
        console.log("USDC:", SlateAddresses.USDC);
        console.log("Swap router (Aerodrome Slipstream):", SlateAddresses.AERODROME_SWAP_ROUTER);
        console.log("Sequencer uptime feed:", SlateAddresses.SEQUENCER_UPTIME_FEED);
        console.log("Pyth:", SlateAddresses.PYTH);
        console.log("Protocol fee recipient:", PROTOCOL_FEE_RECIPIENT);
        console.log("Protocol fee bps:", PROTOCOL_FEE_BPS);

        vm.startBroadcast();
        SlateFactory deployed = new SlateFactory(
            SlateAddresses.USDC,
            SlateAddresses.AERODROME_SWAP_ROUTER,
            SlateAddresses.SEQUENCER_UPTIME_FEED,
            SlateAddresses.PYTH,
            PROTOCOL_FEE_RECIPIENT,
            PROTOCOL_FEE_BPS
        );
        vm.stopBroadcast();

        factory = address(deployed);
        console.log("");
        console.log("SlateFactory deployed at:", factory);
        console.log("Set NEXT_PUBLIC_FACTORY_ADDRESS to this value.");
    }
}
