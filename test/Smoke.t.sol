// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SlateFund} from "../src/SlateFund.sol";
import {MockTokenizedStock} from "./mocks/MockTokenizedStock.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {IB20Asset} from "base-std/interfaces/IB20Asset.sol";

contract SmokeTest is Test {
    function test_deployFundWithMockComponents() public {
        IB20Asset usdc = MockTokenizedStock.deploy(bytes32(uint256(1)), "Mock USDC", "mUSDC", 6, address(this));
        IB20Asset nvda = MockTokenizedStock.deploy(bytes32(uint256(2)), "Mock NVDA", "mNVDAc", 8, address(this));

        MockAggregator feed = new MockAggregator(8, 20000000000); // $200.00000000

        SlateFund.ComponentInput[] memory components = new SlateFund.ComponentInput[](1);
        components[0] = SlateFund.ComponentInput({token: address(nvda), feed: address(feed), targetWeightBps: 10_000, pool: address(0)});

        SlateFund fund = new SlateFund(
            bytes32(uint256(3)),
            "Slate Test Fund",
            "SLTEST",
            address(usdc),
            address(0xBEEF),
            address(this),
            components,
            "Test fund",
            SlateFund.ProtectionConfig({
                sequencerUptimeFeed: address(0),
                pyth: address(0),
                protocolFeeRecipient: address(0),
                protocolFeeBps: 0
            })
        );

        assertEq(fund.componentsLength(), 1);
        assertEq(address(fund.USDC()), address(usdc));
        assertEq(fund.OPERATOR(), address(this));

        usdc.mint(address(this), 1000e6);
        nvda.mint(address(fund), 5e8); // 5 whole NVDAc @ 8 decimals

        // NAV should be exactly 5 * $200 = $1000.00 (6dp USDC terms), no cash.
        assertEq(fund.totalNAV(), 1000e6);
    }
}
