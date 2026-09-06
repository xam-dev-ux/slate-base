// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SlateFactory} from "../src/SlateFactory.sol";
import {SlateFund} from "../src/SlateFund.sol";
import {SlateAddresses} from "../script/SlateAddresses.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Asset} from "base-std/interfaces/IB20Asset.sol";

/// @dev Exercises the exact deployment path the scripts take — same factory, same basket
///      definitions, same index-rule strings — against real Base mainnet state, so the mainnet
///      deploy is a rehearsal rather than a first attempt.
contract DeployForkTest is Test {
    uint256 internal constant FORK_BLOCK = 50_878_627;

    SlateFactory internal factory;

    function setUp() public {
        vm.createSelectFork(vm.envOr("MAINNET_RPC_URL", string("https://mainnet.base.org")), FORK_BLOCK);
        factory = new SlateFactory(SlateAddresses.USDC, SlateAddresses.ZEROX_ALLOWANCE_HOLDER);
    }

    function test_fork_deploysBothCuratedFunds() public {
        address bigTech4 = factory.createFund(
            keccak256("slate.big-tech-4.v1"),
            "Slate Big Tech 4",
            "SLATE4",
            SlateAddresses.bigTech4(),
            SlateAddresses.BIG_TECH_4_RULE
        );
        address aiCore = factory.createFund(
            keccak256("slate.ai-core.v1"),
            "Slate AI Core",
            "SLATEAI",
            SlateAddresses.aiCore(),
            SlateAddresses.AI_CORE_RULE
        );

        assertEq(factory.fundCount(), 2, "both funds registered");
        assertTrue(factory.isFund(bigTech4));
        assertTrue(factory.isFund(aiCore));

        SlateFund f4 = SlateFund(bigTech4);
        SlateFund fai = SlateFund(aiCore);

        assertEq(f4.componentsLength(), 4, "Big Tech 4 has four components");
        assertEq(fai.componentsLength(), 3, "AI Core has three components");

        // The deploying account is the operator — bounded powers only.
        assertEq(f4.OPERATOR(), address(this));
        assertEq(fai.OPERATOR(), address(this));

        // Share tokens exist through the real B20 factory precompile, with the index rule readable
        // on-chain as published metadata.
        IB20Asset share4 = f4.SHARE();
        assertEq(IB20(address(share4)).symbol(), "SLATE4");
        assertEq(IB20(address(share4)).decimals(), 18);
        assertEq(share4.extraMetadata("index_rule"), SlateAddresses.BIG_TECH_4_RULE);
        assertEq(
            share4.extraMetadata("operator_powers"),
            "pause deposits, adjust bounded params. Cannot move funds."
        );

        IB20Asset shareAi = fai.SHARE();
        assertEq(IB20(address(shareAi)).symbol(), "SLATEAI");
        assertEq(shareAi.extraMetadata("index_rule"), SlateAddresses.AI_CORE_RULE);

        // Both price cleanly against the real feeds while empty.
        assertEq(f4.totalNAV(), 0);
        assertEq(f4.navPerShare(), 1e6, "empty fund quotes one USDC per share");
        (bool healthy,) = f4.feedsHealthy();
        assertTrue(healthy, "real feeds healthy at the pinned block");
    }

    /// @dev The factory is permissionless: anyone can launch their own index, and they operate it.
    function test_fork_factoryIsPermissionless() public {
        address stranger = address(0xDEADBEEF);

        vm.prank(stranger);
        address theirFund = factory.createFund(
            keccak256("someone.elses.index"),
            "Someone Elses Index",
            "SEI",
            SlateAddresses.aiCore(),
            "A basket deployed by an unrelated account."
        );

        assertEq(SlateFund(theirFund).OPERATOR(), stranger, "caller operates their own fund");
        assertTrue(factory.isFund(theirFund));
    }
}
