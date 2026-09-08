// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SlateFund} from "../src/SlateFund.sol";
import {MockTokenizedStock} from "./mocks/MockTokenizedStock.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockRouter} from "./mocks/MockRouter.sol";
import {MockSequencerFeed} from "./mocks/MockSequencerFeed.sol";
import {MockPyth} from "./mocks/MockPyth.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Asset} from "base-std/interfaces/IB20Asset.sol";

/// @dev Same 50/50 two-component fixture as SlateFund.t.sol, but wired up with a real sequencer
///      feed, a real Pyth mock, and a non-zero protocol fee — the three ProtectionConfig fields
///      SlateFund.t.sol's own fixture deliberately leaves disabled. Kept in a separate file/fixture
///      rather than added to the existing one so every pre-existing test keeps proving the
///      contract behaves identically with all three off.
contract SlateFundProtectionsTest is Test {
    IB20Asset internal usdc;
    IB20Asset internal tokenA;
    IB20Asset internal tokenB;
    MockAggregator internal feedA;
    MockAggregator internal feedB;
    MockRouter internal router;
    MockSequencerFeed internal sequencer;
    MockPyth internal pyth;
    SlateFund internal fund;
    IB20Asset internal share;

    address internal alice = address(0xA11CE);
    address internal protocolTreasury = address(0x7EA5);

    int256 internal constant PRICE = 200e8; // $200.00000000, 8dp feed
    uint256 internal constant DEPOSIT = 100e6; // 100 USDC
    uint16 internal constant PROTOCOL_FEE_BPS = 50; // 0.5%

    bytes32 internal constant PYTH_ID_A = bytes32(uint256(1));

    function setUp() public {
        usdc = MockTokenizedStock.deploy(bytes32(uint256(1)), "Mock USDC", "mUSDC", 6, address(this));
        tokenA = MockTokenizedStock.deploy(bytes32(uint256(2)), "Mock NVDA", "mNVDAc", 8, address(this));
        tokenB = MockTokenizedStock.deploy(bytes32(uint256(3)), "Mock AAPL", "mAAPLc", 8, address(this));

        feedA = new MockAggregator(8, PRICE);
        feedB = new MockAggregator(8, PRICE);
        router = new MockRouter();
        sequencer = new MockSequencerFeed();
        pyth = new MockPyth();

        SlateFund.ComponentInput[] memory comps = new SlateFund.ComponentInput[](2);
        comps[0] = SlateFund.ComponentInput({token: address(tokenA), feed: address(feedA), targetWeightBps: 5_000, pool: address(0)});
        comps[1] = SlateFund.ComponentInput({token: address(tokenB), feed: address(feedB), targetWeightBps: 5_000, pool: address(0)});

        fund = new SlateFund(
            bytes32(uint256(5)),
            "Slate Protections Test",
            "SLATEP",
            address(usdc),
            address(router),
            address(this),
            comps,
            "Protections test basket.",
            SlateFund.ProtectionConfig({
                sequencerUptimeFeed: address(sequencer),
                pyth: address(pyth),
                protocolFeeRecipient: protocolTreasury,
                protocolFeeBps: PROTOCOL_FEE_BPS
            })
        );
        share = fund.SHARE();

        // The sequencer mock starts "up" as of construction time — advance well past the grace
        // period so tests that don't care about the sequencer aren't fighting it by default.
        vm.warp(block.timestamp + 2 hours);
        _freshenFeeds();

        usdc.mint(alice, 10_000e6);
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _expectedUnits(uint256 usdcAmount, int256 price) internal pure returns (uint256) {
        return (usdcAmount * 1e16) / (1e6 * uint256(price));
    }

    function _swapData(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeCall(MockRouter.swap, (tokenIn, tokenOut, amountIn, amountOut));
    }

    function _freshenFeeds() internal {
        feedA.setUpdatedAt(block.timestamp);
        feedB.setUpdatedAt(block.timestamp);
    }

    function _depositBalanced(address user, uint256 amount) internal returns (uint256 sharesMinted) {
        uint256 half = amount / 2;
        uint256 outA = _expectedUnits(half, feedA.answer());
        uint256 outB = _expectedUnits(half, feedB.answer());

        tokenA.mint(address(router), outA);
        tokenB.mint(address(router), outB);

        uint256[] memory sellAmounts = new uint256[](2);
        sellAmounts[0] = half;
        sellAmounts[1] = half;

        bytes[] memory calls = new bytes[](2);
        calls[0] = _swapData(address(usdc), address(tokenA), half, outA);
        calls[1] = _swapData(address(usdc), address(tokenB), half, outB);

        uint256 before = share.balanceOf(user);
        vm.startPrank(user);
        usdc.approve(address(fund), amount);
        fund.deposit(amount, sellAmounts, calls);
        vm.stopPrank();
        sharesMinted = share.balanceOf(user) - before;
    }

    function _emptyCalls() internal view returns (bytes[] memory calls) {
        calls = new bytes[](fund.componentsLength());
    }

    /*//////////////////////////////////////////////////////////////
                          SEQUENCER UPTIME FEED
    //////////////////////////////////////////////////////////////*/

    function test_sequencerDownBlocksPricing() public {
        _depositBalanced(alice, DEPOSIT);

        sequencer.setStatus(true, block.timestamp);
        vm.expectRevert(SlateFund.SequencerDown.selector);
        fund.totalNAV();
    }

    function test_sequencerJustRestartedBlocksUntilGracePeriodElapses() public {
        _depositBalanced(alice, DEPOSIT);

        // Comes back up right now — still inside the 1h grace period.
        sequencer.setStatus(false, block.timestamp);
        vm.expectRevert(SlateFund.SequencerGracePeriodNotOver.selector);
        fund.totalNAV();

        // Past the grace period, and with feeds refreshed so staleness isn't what reverts instead.
        vm.warp(block.timestamp + fund.SEQUENCER_GRACE_PERIOD() + 1);
        _freshenFeeds();
        uint256 nav = fund.totalNAV();
        assertGt(nav, 0);
    }

    function test_feedsHealthyReportsSequencerDownDistinctly() public {
        sequencer.setStatus(true, block.timestamp);
        (bool healthy, address unhealthyFeed) = fund.feedsHealthy();
        assertFalse(healthy);
        assertEq(unhealthyFeed, address(sequencer));
    }

    function test_sequencerDisabledWhenAddressIsZero() public {
        // A fund built with sequencerUptimeFeed left at address(0) never touches the check at
        // all — covered by every test in SlateFund.t.sol, which all use that fixture. Asserted
        // here too as the direct, named counterpart to the tests above.
        SlateFund.ComponentInput[] memory comps = new SlateFund.ComponentInput[](1);
        comps[0] = SlateFund.ComponentInput({token: address(tokenA), feed: address(feedA), targetWeightBps: 10_000, pool: address(0)});
        SlateFund noSequencerFund = new SlateFund(
            bytes32(uint256(6)),
            "No Sequencer",
            "NOSEQ",
            address(usdc),
            address(router),
            address(this),
            comps,
            "test",
            SlateFund.ProtectionConfig({
                sequencerUptimeFeed: address(0),
                pyth: address(0),
                protocolFeeRecipient: address(0),
                protocolFeeBps: 0
            })
        );
        assertEq(noSequencerFund.totalNAV(), 0);
    }

    /*//////////////////////////////////////////////////////////////
                                  PYTH
    //////////////////////////////////////////////////////////////*/

    function test_pythDivergenceRevertsWhenPricesDisagree() public {
        fund.setPythPriceId(address(tokenA), PYTH_ID_A);
        // Chainlink says $200.00000000 (8dp). Pyth says $250.00 (2dp, expo -2) — 25% apart, well
        // past the 3% default tolerance.
        pyth.setPrice(PYTH_ID_A, 25_000, -2);

        vm.expectRevert(
            abi.encodeWithSelector(SlateFund.PriceDivergence.selector, address(tokenA), uint256(200e8), uint256(250e8))
        );
        fund.totalNAV();
    }

    function test_pythWithinToleranceDoesNotRevert() public {
        _depositBalanced(alice, DEPOSIT);
        fund.setPythPriceId(address(tokenA), PYTH_ID_A);
        // $201.00 vs Chainlink's $200.00 — 0.5% apart, inside the 3% default tolerance.
        pyth.setPrice(PYTH_ID_A, 20_100, -2);

        uint256 nav = fund.totalNAV();
        assertGt(nav, 0);
    }

    function test_pythUnsetForComponentIsNoOp() public {
        _depositBalanced(alice, DEPOSIT);
        // Never called setPythPriceId for tokenA — Pyth being configured at the fund level must
        // not matter for a component that hasn't individually opted in.
        pyth.setPrice(PYTH_ID_A, 999_999_999, -2); // wildly wrong, but irrelevant: unmapped id.
        uint256 nav = fund.totalNAV();
        assertGt(nav, 0);
    }

    function test_onlyOperatorCanSetPythPriceId() public {
        vm.prank(alice);
        vm.expectRevert(SlateFund.NotOperator.selector);
        fund.setPythPriceId(address(tokenA), PYTH_ID_A);
    }

    /*//////////////////////////////////////////////////////////////
                              PROTOCOL FEE
    //////////////////////////////////////////////////////////////*/

    function test_redeemChargesProtocolFeeToRecipient() public {
        _depositBalanced(alice, DEPOSIT);
        uint256 shares = share.balanceOf(alice);

        uint256 cashBefore = usdc.balanceOf(address(fund));
        uint256 grossOut = (cashBefore * shares) / share.totalSupply();
        // Both legs trade at exactly the oracle price in this fixture, so the component-derived
        // share of usdcOut equals its raw balance value 1:1 — outUnits below mirrors that.

        tokenA.mint(address(router), 0); // no-op, keeps mint calls symmetric with other tests
        uint256 balA = tokenA.balanceOf(address(fund));
        uint256 balB = tokenB.balanceOf(address(fund));
        uint256 claimA = (balA * shares) / share.totalSupply();
        uint256 claimB = (balB * shares) / share.totalSupply();
        uint256 outA = (claimA * uint256(feedA.answer()) * 1e6) / 1e16;
        uint256 outB = (claimB * uint256(feedB.answer()) * 1e6) / 1e16;

        bytes[] memory calls = new bytes[](2);
        calls[0] = _swapData(address(tokenA), address(usdc), claimA, outA);
        calls[1] = _swapData(address(tokenB), address(usdc), claimB, outB);
        usdc.mint(address(router), outA + outB);

        uint256 expectedGross = grossOut + outA + outB;
        uint256 expectedFee = (expectedGross * PROTOCOL_FEE_BPS) / 10_000;

        uint256 treasuryBefore = usdc.balanceOf(protocolTreasury);
        vm.startPrank(alice);
        share.approve(address(fund), shares);
        fund.redeem(shares, calls);
        vm.stopPrank();

        assertEq(usdc.balanceOf(protocolTreasury) - treasuryBefore, expectedFee);
        assertEq(usdc.balanceOf(alice), 10_000e6 - DEPOSIT + (expectedGross - expectedFee));
    }

    function test_rebalanceChargesProtocolFeeToRecipient() public {
        // Same shape as SlateFund.t.sol's test_rebalanceCallerReceivesReward: deposit leaving a
        // cash cushion (which itself drags both weights below target), then spend part of it on
        // a "buy" leg — amounts already denominated in USDC, so tradedValue is exact with no
        // raw-unit round-trip to introduce rounding drift into the fee assertion below.
        uint256 perComponent = 40e6;
        uint256 unitsA = _expectedUnits(perComponent, PRICE);
        uint256 unitsB = _expectedUnits(perComponent, PRICE);
        tokenA.mint(address(router), unitsA);
        tokenB.mint(address(router), unitsB);

        uint256[] memory sellAmounts = new uint256[](2);
        sellAmounts[0] = perComponent;
        sellAmounts[1] = perComponent;
        bytes[] memory depositCalls = new bytes[](2);
        depositCalls[0] = _swapData(address(usdc), address(tokenA), perComponent, unitsA);
        depositCalls[1] = _swapData(address(usdc), address(tokenB), perComponent, unitsB);

        vm.startPrank(alice);
        usdc.approve(address(fund), DEPOSIT);
        fund.deposit(DEPOSIT, sellAmounts, depositCalls);
        vm.stopPrank();

        vm.warp(block.timestamp + 8 days);
        _freshenFeeds();

        uint256 buyEach = 7.5e6;
        uint256 unitsEach = _expectedUnits(buyEach, PRICE);
        tokenA.mint(address(router), unitsEach);
        tokenB.mint(address(router), unitsEach);

        int256[] memory amounts = new int256[](2);
        amounts[0] = int256(buyEach);
        amounts[1] = int256(buyEach);
        bytes[] memory calls = new bytes[](2);
        calls[0] = _swapData(address(usdc), address(tokenA), buyEach, unitsEach);
        calls[1] = _swapData(address(usdc), address(tokenB), buyEach, unitsEach);

        uint256 treasuryBefore = usdc.balanceOf(protocolTreasury);
        fund.rebalance(amounts, calls);

        uint256 tradedValue = buyEach * 2;
        uint256 expectedFee = (tradedValue * PROTOCOL_FEE_BPS) / 10_000;
        assertEq(usdc.balanceOf(protocolTreasury) - treasuryBefore, expectedFee);
    }

    /*//////////////////////////////////////////////////////////////
                          CONSTRUCTION SAFETY
    //////////////////////////////////////////////////////////////*/

    function test_nonZeroFeeWithZeroRecipientRevertsAtConstruction() public {
        SlateFund.ComponentInput[] memory comps = new SlateFund.ComponentInput[](1);
        comps[0] = SlateFund.ComponentInput({token: address(tokenA), feed: address(feedA), targetWeightBps: 10_000, pool: address(0)});

        vm.expectRevert(SlateFund.OutOfBounds.selector);
        new SlateFund(
            bytes32(uint256(7)),
            "Bad Fee Config",
            "BADFEE",
            address(usdc),
            address(router),
            address(this),
            comps,
            "test",
            SlateFund.ProtectionConfig({
                sequencerUptimeFeed: address(0),
                pyth: address(0),
                protocolFeeRecipient: address(0),
                protocolFeeBps: 10
            })
        );
    }

    function test_feeAboveCeilingRevertsAtConstruction() public {
        SlateFund.ComponentInput[] memory comps = new SlateFund.ComponentInput[](1);
        comps[0] = SlateFund.ComponentInput({token: address(tokenA), feed: address(feedA), targetWeightBps: 10_000, pool: address(0)});

        vm.expectRevert(SlateFund.OutOfBounds.selector);
        new SlateFund(
            bytes32(uint256(8)),
            "Fee Too High",
            "HIGHFEE",
            address(usdc),
            address(router),
            address(this),
            comps,
            "test",
            SlateFund.ProtectionConfig({
                sequencerUptimeFeed: address(0),
                pyth: address(0),
                protocolFeeRecipient: protocolTreasury,
                protocolFeeBps: 101
            })
        );
    }
}
