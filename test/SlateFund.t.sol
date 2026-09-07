// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SlateFund} from "../src/SlateFund.sol";
import {MockTokenizedStock} from "./mocks/MockTokenizedStock.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockRouter} from "./mocks/MockRouter.sol";
import {MockReentrantRouter} from "./mocks/MockReentrantRouter.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Asset} from "base-std/interfaces/IB20Asset.sol";

/// @dev Fixture: a 50/50 two-component fund. Both components are 8-decimal B20 assets priced at
///      $200 by 8-decimal feeds, matching the real Coinbase Tokenized Stock / Chainlink shape
///      confirmed on mainnet. USDC stand-in is a 6-decimal B20 asset — `SlateFund` only uses the
///      standard ERC-20 selector set, which real USDC shares.
contract SlateFundTest is Test {
    IB20Asset internal usdc;
    IB20Asset internal tokenA;
    IB20Asset internal tokenB;
    MockAggregator internal feedA;
    MockAggregator internal feedB;
    MockRouter internal router;
    SlateFund internal fund;
    IB20Asset internal share;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    int256 internal constant PRICE = 200e8; // $200.00000000, 8dp feed
    uint256 internal constant DEPOSIT = 100e6; // 100 USDC

    function setUp() public {
        usdc = MockTokenizedStock.deploy(bytes32(uint256(1)), "Mock USDC", "mUSDC", 6, address(this));
        tokenA = MockTokenizedStock.deploy(bytes32(uint256(2)), "Mock NVDA", "mNVDAc", 8, address(this));
        tokenB = MockTokenizedStock.deploy(bytes32(uint256(3)), "Mock AAPL", "mAAPLc", 8, address(this));

        feedA = new MockAggregator(8, PRICE);
        feedB = new MockAggregator(8, PRICE);
        router = new MockRouter();

        SlateFund.ComponentInput[] memory comps = new SlateFund.ComponentInput[](2);
        comps[0] = SlateFund.ComponentInput({token: address(tokenA), feed: address(feedA), targetWeightBps: 5_000, pool: address(0)});
        comps[1] = SlateFund.ComponentInput({token: address(tokenB), feed: address(feedB), targetWeightBps: 5_000, pool: address(0)});

        fund = new SlateFund(
            bytes32(uint256(4)),
            "Slate Big Tech 2",
            "SLATE2",
            address(usdc),
            address(router),
            address(this),
            comps,
            "Equal-weight two-component test basket."
        );
        share = fund.SHARE();

        usdc.mint(alice, 10_000e6);
        usdc.mint(bob, 10_000e6);
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Raw component units the oracle says `usdcAmount` should buy at `price`.
    function _expectedUnits(uint256 usdcAmount, int256 price) internal pure returns (uint256) {
        return (usdcAmount * 1e16) / (1e6 * uint256(price));
    }

    /// @dev USDC the oracle says `rawUnits` of an 8dp component is worth at `price`.
    function _expectedUsdc(uint256 rawUnits, int256 price) internal pure returns (uint256) {
        return (rawUnits * uint256(price) * 1e6) / 1e16;
    }

    function _swapData(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeCall(MockRouter.swap, (tokenIn, tokenOut, amountIn, amountOut));
    }

    /// @dev Deposits `amount` USDC from `user`, splitting it 50/50 into both components at exactly
    ///      the oracle price (zero slippage).
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

    /// @dev Real 24/5 feeds keep publishing during market hours; `vm.warp` alone would leave the
    ///      mocks looking stale, so refresh them whenever a test moves time forward deliberately.
    function _freshenFeeds() internal {
        feedA.setUpdatedAt(block.timestamp);
        feedB.setUpdatedAt(block.timestamp);
    }

    function _zeroAmounts() internal view returns (int256[] memory amounts) {
        amounts = new int256[](fund.componentsLength());
    }

    /*//////////////////////////////////////////////////////////////
                                DEPOSITS
    //////////////////////////////////////////////////////////////*/

    function test_firstDepositBootstrapsShares() public {
        uint256 minted = _depositBalanced(alice, DEPOSIT);

        // 100 USDC (6dp) in an empty fund bootstraps to 100 shares (18dp).
        assertEq(minted, 100e18, "bootstrap share count");
        assertEq(fund.totalNAV(), DEPOSIT, "NAV equals deposit");
        assertEq(fund.navPerShare(), 1e6, "NAV per share starts at 1 USDC");
        assertEq(tokenA.balanceOf(address(fund)), _expectedUnits(DEPOSIT / 2, PRICE));
        assertEq(tokenB.balanceOf(address(fund)), _expectedUnits(DEPOSIT / 2, PRICE));
    }

    function test_secondDepositMintsProportionally() public {
        uint256 aliceShares = _depositBalanced(alice, DEPOSIT);
        uint256 bobShares = _depositBalanced(bob, DEPOSIT);

        // Same deposit at an unchanged NAV must mint the same number of shares.
        assertEq(bobShares, aliceShares, "proportional mint");
        assertEq(fund.totalNAV(), DEPOSIT * 2, "NAV is both deposits");
        assertEq(share.totalSupply(), aliceShares + bobShares);
    }

    function test_depositRevertsOverWalletCap() public {
        uint256 tooMuch = fund.maxPositionPerWallet() + 1;
        uint256 half = tooMuch / 2;
        uint256[] memory sellAmounts = new uint256[](2);
        sellAmounts[0] = half;
        sellAmounts[1] = half;
        bytes[] memory calls = _emptyCalls();

        vm.startPrank(alice);
        usdc.approve(address(fund), tooMuch);
        vm.expectRevert(SlateFund.ExceedsWalletCap.selector);
        fund.deposit(tooMuch, sellAmounts, calls);
        vm.stopPrank();
    }

    function test_depositRevertsOverFundCap() public {
        // Room for one deposit but not two, with the wallet cap deliberately not the binding one.
        fund.setCaps(DEPOSIT, 150e6);
        _depositBalanced(alice, DEPOSIT);

        uint256[] memory sellAmounts = new uint256[](2);
        bytes[] memory calls = _emptyCalls();

        vm.startPrank(bob);
        usdc.approve(address(fund), DEPOSIT);
        vm.expectRevert(SlateFund.ExceedsFundCap.selector);
        fund.deposit(DEPOSIT, sellAmounts, calls);
        vm.stopPrank();
    }

    function test_depositRevertsWhenPaused() public {
        fund.setDepositsPaused(true);

        uint256[] memory sellAmounts = new uint256[](2);
        bytes[] memory calls = _emptyCalls();

        vm.startPrank(alice);
        usdc.approve(address(fund), DEPOSIT);
        vm.expectRevert(SlateFund.DepositsArePaused.selector);
        fund.deposit(DEPOSIT, sellAmounts, calls);
        vm.stopPrank();
    }

    function test_depositRevertsOnStaleFeed() public {
        vm.warp(block.timestamp + 100 days);
        feedB.setUpdatedAt(block.timestamp - 73 hours); // past the 72h tolerance
        feedA.setUpdatedAt(block.timestamp);

        uint256[] memory sellAmounts = new uint256[](2);
        bytes[] memory calls = _emptyCalls();

        vm.startPrank(alice);
        usdc.approve(address(fund), DEPOSIT);
        vm.expectRevert(
            abi.encodeWithSelector(SlateFund.StaleFeed.selector, address(feedB), block.timestamp - 73 hours)
        );
        fund.deposit(DEPOSIT, sellAmounts, calls);
        vm.stopPrank();
    }

    /// @dev A router paying out far below the oracle-implied amount must be rejected. This is the
    ///      security boundary for off-chain-built swap calldata.
    function test_depositRevertsOnBadSwapRate() public {
        uint256 half = DEPOSIT / 2;
        uint256 fair = _expectedUnits(half, PRICE);
        uint256 terrible = fair / 2; // 50% worse than oracle — way past maxSlippageBps

        tokenA.mint(address(router), fair);
        tokenB.mint(address(router), fair);

        uint256[] memory sellAmounts = new uint256[](2);
        sellAmounts[0] = half;
        sellAmounts[1] = half;

        bytes[] memory calls = new bytes[](2);
        calls[0] = _swapData(address(usdc), address(tokenA), half, terrible);
        calls[1] = _swapData(address(usdc), address(tokenB), half, fair);

        vm.startPrank(alice);
        usdc.approve(address(fund), DEPOSIT);
        vm.expectRevert(
            abi.encodeWithSelector(SlateFund.SlippageExceeded.selector, address(tokenA), fair, terrible)
        );
        fund.deposit(DEPOSIT, sellAmounts, calls);
        vm.stopPrank();
    }

    /// @dev A depositor must never be able to route more USDC into swaps than they deposited —
    ///      that would spend other holders' pooled cash.
    function test_depositCannotOverAllocateOthersCash() public {
        _depositBalanced(alice, DEPOSIT); // seeds pooled assets

        uint256[] memory sellAmounts = new uint256[](2);
        sellAmounts[0] = DEPOSIT; // together these exceed bob's own deposit
        sellAmounts[1] = DEPOSIT;
        bytes[] memory calls = _emptyCalls();

        vm.startPrank(bob);
        usdc.approve(address(fund), DEPOSIT);
        vm.expectRevert(SlateFund.AllocationExceedsDeposit.selector);
        fund.deposit(DEPOSIT, sellAmounts, calls);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                              REDEMPTIONS
    //////////////////////////////////////////////////////////////*/

    function test_redeemReturnsProportionalUsdc() public {
        uint256 shares = _depositBalanced(alice, DEPOSIT);

        uint256 claimA = tokenA.balanceOf(address(fund));
        uint256 claimB = tokenB.balanceOf(address(fund));
        uint256 outA = _expectedUsdc(claimA, PRICE);
        uint256 outB = _expectedUsdc(claimB, PRICE);
        usdc.mint(address(router), outA + outB);

        bytes[] memory calls = new bytes[](2);
        calls[0] = _swapData(address(tokenA), address(usdc), claimA, outA);
        calls[1] = _swapData(address(tokenB), address(usdc), claimB, outB);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.startPrank(alice);
        share.approve(address(fund), shares);
        fund.redeem(shares, calls);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice) - balBefore, DEPOSIT, "redeems the full deposit back");
        assertEq(share.balanceOf(alice), 0, "shares burned");
        assertEq(share.totalSupply(), 0, "supply burned down");
    }

    /// @dev Positions are divisible: redeem part of a holding and keep the rest, with the fund and
    ///      the remaining shares both left proportionally intact.
    function test_partialRedeemLeavesTheRestOfThePositionIntact() public {
        uint256 shares = _depositBalanced(alice, DEPOSIT);
        uint256 half = shares / 2;

        uint256 claimA = tokenA.balanceOf(address(fund)) / 2;
        uint256 claimB = tokenB.balanceOf(address(fund)) / 2;
        uint256 outA = _expectedUsdc(claimA, PRICE);
        uint256 outB = _expectedUsdc(claimB, PRICE);
        usdc.mint(address(router), outA + outB);

        bytes[] memory calls = new bytes[](2);
        calls[0] = _swapData(address(tokenA), address(usdc), claimA, outA);
        calls[1] = _swapData(address(tokenB), address(usdc), claimB, outB);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.startPrank(alice);
        share.approve(address(fund), half);
        fund.redeem(half, calls);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice) - balBefore, DEPOSIT / 2, "half the value comes back");
        assertEq(share.balanceOf(alice), shares - half, "the other half is still held");
        assertEq(fund.totalNAV(), DEPOSIT / 2, "fund keeps the untouched half");
        assertEq(fund.navPerShare(), 1e6, "NAV per share unchanged by a partial exit");
    }

    /// @dev The unconditional exit path: no router, no oracle, works while paused and with every
    ///      feed frozen.
    function test_redeemInKindWorksPausedAndFullyStale() public {
        uint256 shares = _depositBalanced(alice, DEPOSIT);
        uint256 fundA = tokenA.balanceOf(address(fund));
        uint256 fundB = tokenB.balanceOf(address(fund));

        fund.setDepositsPaused(true);
        vm.warp(block.timestamp + 100 days);
        feedA.setUpdatedAt(1); // ancient
        feedB.setUpdatedAt(1);

        // Pricing is impossible right now — prove it, then prove the exit still works.
        vm.expectRevert();
        fund.totalNAV();

        vm.startPrank(alice);
        share.approve(address(fund), shares);
        fund.redeemInKind(shares);
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), fundA, "received full A claim");
        assertEq(tokenB.balanceOf(alice), fundB, "received full B claim");
        assertEq(share.balanceOf(alice), 0);
    }

    /// @dev Caps bound live exposure, not lifetime flow. A holder who exits must be able to come
    ///      back — otherwise the demo itself (deposit, redeem, deposit again) reverts, and anyone
    ///      who ever used their full allowance is locked out permanently.
    function test_exitingFreesCapacityToDepositAgain() public {
        fund.setCaps(DEPOSIT, DEPOSIT); // wallet and fund caps both exactly one deposit

        uint256 shares = _depositBalanced(alice, DEPOSIT);
        assertEq(fund.depositedBy(alice), DEPOSIT, "allowance consumed");
        assertEq(fund.totalDeposited(), DEPOSIT);

        vm.startPrank(alice);
        share.approve(address(fund), shares);
        fund.redeemInKind(shares);
        vm.stopPrank();

        assertEq(fund.depositedBy(alice), 0, "full exit frees the wallet allowance");
        assertEq(fund.totalDeposited(), 0, "and the fund allowance");

        // The fund is empty again, so depositing must work exactly as it did the first time.
        uint256 reShares = _depositBalanced(alice, DEPOSIT);
        assertGt(reShares, 0, "holder can re-enter after exiting");
    }

    /// @dev A partial exit frees a proportional slice, not everything.
    function test_partialExitFreesProportionalCapacity() public {
        uint256 shares = _depositBalanced(alice, DEPOSIT);

        vm.startPrank(alice);
        share.approve(address(fund), shares / 4);
        fund.redeemInKind(shares / 4);
        vm.stopPrank();

        assertApproxEqAbs(fund.depositedBy(alice), (DEPOSIT * 3) / 4, 2, "three quarters still used");
    }

    /// @dev The components are policy-gated by their issuer, who can freeze one at any time. If a
    ///      single frozen component could block the in-kind exit, every holder would be trapped and
    ///      the unconditional exit would be conditional on a third party.
    function test_oneFrozenComponentCannotTrapHolders() public {
        uint256 shares = _depositBalanced(alice, DEPOSIT);
        uint256 claimA = tokenA.balanceOf(address(fund)) ;

        // Freeze transfers on component B, exactly as its issuer could.
        tokenB.grantRole(keccak256("PAUSE_ROLE"), address(this));
        IB20.PausableFeature[] memory features = new IB20.PausableFeature[](1);
        features[0] = IB20.PausableFeature.TRANSFER;
        tokenB.pause(features);

        // The all-or-nothing exit is now impossible — this is the trap being guarded against.
        vm.startPrank(alice);
        share.approve(address(fund), shares);
        vm.expectRevert();
        fund.redeemInKind(shares);
        vm.stopPrank();

        // The escape hatch still gets the holder out, with the frozen component reported.
        vm.startPrank(alice);
        share.approve(address(fund), shares);
        fund.redeemInKindSkippingBlocked(shares);
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), claimA, "received everything that could move");
        assertEq(tokenB.balanceOf(alice), 0, "the frozen component was given up");
        assertEq(share.balanceOf(alice), 0, "the holder is out");
        assertEq(share.totalSupply(), 0, "shares burned");
    }

    /// @dev The fund's USDC is part of what a share represents, so an in-kind exit that returned
    ///      only the components would quietly hand the redeemer's cash to whoever stayed. A deposit
    ///      that allocates nothing to swaps is explicitly allowed, and such a position is all cash.
    function test_inKindExitReturnsTheCashSliceToo() public {
        uint256[] memory sellAmounts = new uint256[](2); // allocate nothing: the position is cash
        bytes[] memory calls = _emptyCalls();

        vm.startPrank(alice);
        usdc.approve(address(fund), DEPOSIT);
        fund.deposit(DEPOSIT, sellAmounts, calls);
        vm.stopPrank();

        uint256 shares = share.balanceOf(alice);
        uint256 balBefore = usdc.balanceOf(alice);

        vm.startPrank(alice);
        share.approve(address(fund), shares);
        fund.redeemInKind(shares);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice) - balBefore, DEPOSIT, "the entire position came back");
        assertEq(fund.totalNAV(), 0, "nothing stranded in the fund");
    }

    /// @dev Half cash, half components: both halves must come back.
    function test_inKindExitReturnsCashAndComponentsTogether() public {
        uint256 perComponent = 40e6; // leaves 20 USDC of the 100 as cash
        uint256 units = _expectedUnits(perComponent, PRICE);
        tokenA.mint(address(router), units);
        tokenB.mint(address(router), units);

        uint256[] memory sellAmounts = new uint256[](2);
        sellAmounts[0] = perComponent;
        sellAmounts[1] = perComponent;
        bytes[] memory calls = new bytes[](2);
        calls[0] = _swapData(address(usdc), address(tokenA), perComponent, units);
        calls[1] = _swapData(address(usdc), address(tokenB), perComponent, units);

        vm.startPrank(alice);
        usdc.approve(address(fund), DEPOSIT);
        fund.deposit(DEPOSIT, sellAmounts, calls);
        vm.stopPrank();

        uint256 shares = share.balanceOf(alice);
        uint256 balBefore = usdc.balanceOf(alice);

        vm.startPrank(alice);
        share.approve(address(fund), shares);
        fund.redeemInKind(shares);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice) - balBefore, 20e6, "the cash sleeve came back");
        assertEq(tokenA.balanceOf(alice), units, "and component A");
        assertEq(tokenB.balanceOf(alice), units, "and component B");
        assertEq(fund.totalNAV(), 0, "nothing left behind");
    }

    function test_redeemingEntireSupplyLeavesNoDust() public {
        uint256 aliceShares = _depositBalanced(alice, DEPOSIT);
        uint256 bobShares = _depositBalanced(bob, DEPOSIT);

        vm.startPrank(alice);
        share.approve(address(fund), aliceShares);
        fund.redeemInKind(aliceShares);
        vm.stopPrank();

        vm.startPrank(bob);
        share.approve(address(fund), bobShares);
        fund.redeemInKind(bobShares);
        vm.stopPrank();

        assertEq(share.totalSupply(), 0, "supply fully burned");
        assertEq(tokenA.balanceOf(address(fund)), 0, "no A dust");
        assertEq(tokenB.balanceOf(address(fund)), 0, "no B dust");
        assertEq(fund.totalNAV(), 0, "fund empty");
    }

    /*//////////////////////////////////////////////////////////////
                       REBALANCING (PERMISSIONLESS)
    //////////////////////////////////////////////////////////////*/

    /// @dev Doubles component A's price so A is overweight and a rebalance is warranted.
    ///      Returns the legs that restore the 50/50 split exactly.
    function _driftAndPlanRebalance()
        internal
        returns (int256[] memory amounts, bytes[] memory calls)
    {
        feedA.setAnswer(PRICE * 2); // A: $50 -> $100 of value, NAV 100 -> 150

        uint256 sellRawA = 6_250_000; // $25 of A at the doubled price
        uint256 sellProceeds = 25e6;
        uint256 buyUsdcB = 25e6;
        uint256 buyUnitsB = _expectedUnits(buyUsdcB, PRICE);

        usdc.mint(address(router), sellProceeds);
        tokenB.mint(address(router), buyUnitsB);

        amounts = new int256[](2);
        amounts[0] = -int256(sellRawA);
        amounts[1] = int256(buyUsdcB);

        calls = new bytes[](2);
        calls[0] = _swapData(address(tokenA), address(usdc), sellRawA, sellProceeds);
        calls[1] = _swapData(address(usdc), address(tokenB), buyUsdcB, buyUnitsB);
    }

    function test_rebalanceRevertsBeforeInterval() public {
        _depositBalanced(alice, DEPOSIT);
        (int256[] memory amounts, bytes[] memory calls) = _driftAndPlanRebalance();

        vm.expectRevert(SlateFund.RebalanceTooSoon.selector);
        fund.rebalance(amounts, calls);
    }

    function test_rebalanceRevertsWithoutDrift() public {
        _depositBalanced(alice, DEPOSIT);
        vm.warp(block.timestamp + 8 days);
        _freshenFeeds();
        feedA.setAnswer(PRICE);
        feedB.setAnswer(PRICE);

        int256[] memory amounts = _zeroAmounts();
        bytes[] memory calls = _emptyCalls();

        vm.expectRevert(SlateFund.NoDriftDetected.selector);
        fund.rebalance(amounts, calls);
    }

    function test_rebalanceRestoresWeightsAndAnnounces() public {
        _depositBalanced(alice, DEPOSIT);
        fund.setCallerReward(0); // isolate mechanics; reward has its own test
        vm.warp(block.timestamp + 8 days);
        _freshenFeeds();
        (int256[] memory amounts, bytes[] memory calls) = _driftAndPlanRebalance();

        vm.recordLogs();
        fund.rebalance(amounts, calls);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Weights restored to target, no value lost at oracle-fair prices.
        uint16[] memory weights = fund.currentWeights();
        assertEq(weights[0], 5_000, "A back at target");
        assertEq(weights[1], 5_000, "B back at target");
        assertEq(fund.totalNAV(), 150e6, "NAV preserved through the rebalance");
        assertEq(fund.rebalanceCount(), 1, "rebalance counted");

        // The announcement bracket must carry the human-readable reason on-chain.
        string memory expectedReason =
            "mAAPLc drifted down to 33.33% (target 50.00%). Rebalancing to restore target weights.";
        bool foundAnnouncement;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("Announcement(address,string,string,string)")) {
                (string memory id, string memory description,) =
                    abi.decode(logs[i].data, (string, string, string));
                assertEq(id, "rebalance-0", "announcement id");
                assertEq(description, expectedReason, "announcement description");
                assertEq(logs[i].emitter, address(share), "announced on the share token");
                foundAnnouncement = true;
            }
        }
        assertTrue(foundAnnouncement, "Announcement event emitted");
    }

    function test_rebalanceCallerReceivesReward() public {
        // Deposit leaving 20 USDC of cash, which itself drags both weights below target.
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

        assertEq(usdc.balanceOf(address(fund)), 20e6, "cash cushion retained");
        vm.warp(block.timestamp + 8 days);
        _freshenFeeds();

        // Spend 15 of the 20 USDC cash, leaving enough to pay the caller reward.
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

        uint256 balBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        fund.rebalance(amounts, calls);

        // 0.25% of the 15 USDC actually traded — not of the 100 USDC fund. Paying a share of total
        // NAV would reward churning the fund far beyond the work done.
        uint256 traded = buyEach * 2;
        assertEq(
            usdc.balanceOf(bob) - balBefore,
            (traded * fund.callerRewardBps()) / 10_000,
            "caller reward is charged on traded value"
        );
    }

    /// @dev Anyone can trigger a warranted rebalance — that is the trust pitch.
    function testFuzz_rebalanceIsPermissionless(address caller) public {
        vm.assume(caller != address(0));
        vm.assume(caller.code.length == 0);
        vm.assume(caller != address(fund) && caller != address(share) && caller != address(router));
        vm.assume(caller != address(tokenA) && caller != address(tokenB));
        vm.assume(caller != address(feedA) && caller != address(feedB));

        _depositBalanced(alice, DEPOSIT);
        fund.setCallerReward(0);
        vm.warp(block.timestamp + 8 days);
        _freshenFeeds();
        (int256[] memory amounts, bytes[] memory calls) = _driftAndPlanRebalance();

        vm.prank(caller);
        fund.rebalance(amounts, calls);

        assertEq(fund.rebalanceCount(), 1, "any caller can rebalance");
    }

    /// @dev A swap executing far off the oracle price must unwind the entire rebalance.
    function test_rebalanceRevertsOnSlippageAtomically() public {
        _depositBalanced(alice, DEPOSIT);
        fund.setCallerReward(0);
        vm.warp(block.timestamp + 8 days);
        _freshenFeeds();

        feedA.setAnswer(PRICE * 2);
        uint256 sellRawA = 6_250_000;
        uint256 fairProceeds = 25e6;
        uint256 terribleProceeds = 10e6; // way past maxSlippageBps
        usdc.mint(address(router), fairProceeds);

        int256[] memory amounts = new int256[](2);
        amounts[0] = -int256(sellRawA);
        bytes[] memory calls = new bytes[](2);
        calls[0] = _swapData(address(tokenA), address(usdc), sellRawA, terribleProceeds);

        uint256 aBefore = tokenA.balanceOf(address(fund));
        uint256 bBefore = tokenB.balanceOf(address(fund));
        uint256 supplyBefore = share.totalSupply();

        vm.expectRevert(
            abi.encodeWithSelector(
                SlateFund.SlippageExceeded.selector, address(usdc), fairProceeds, terribleProceeds
            )
        );
        fund.rebalance(amounts, calls);

        assertEq(tokenA.balanceOf(address(fund)), aBefore, "A untouched");
        assertEq(tokenB.balanceOf(address(fund)), bBefore, "B untouched");
        assertEq(share.totalSupply(), supplyBefore, "supply untouched");
        assertEq(fund.rebalanceCount(), 0, "no rebalance recorded");
    }

    /// @dev A caller must not be able to push a component further away from its target while
    ///      still passing the per-swap slippage check.
    function test_rebalanceRejectsWrongDirection() public {
        _depositBalanced(alice, DEPOSIT);
        vm.warp(block.timestamp + 8 days);
        _freshenFeeds();
        feedA.setAnswer(PRICE * 2); // A overweight, B underweight

        // Try to buy MORE of the already-overweight A.
        uint256 buyUsdc = 1e6;
        int256[] memory amounts = new int256[](2);
        amounts[0] = int256(buyUsdc);
        bytes[] memory calls = new bytes[](2);
        calls[0] = _swapData(address(usdc), address(tokenA), buyUsdc, 1);

        vm.expectRevert(abi.encodeWithSelector(SlateFund.ComponentNotUnderweight.selector, uint256(0)));
        fund.rebalance(amounts, calls);
    }

    /*//////////////////////////////////////////////////////////////
                          MULTIPLIER HANDLING
    //////////////////////////////////////////////////////////////*/

    function test_scaledHoldingsReflectMultiplier() public {
        _depositBalanced(alice, DEPOSIT);
        uint256 rawBefore = tokenA.balanceOf(address(fund));

        tokenA.updateUIMultiplier(2e18, block.timestamp + 1);
        vm.warp(block.timestamp + 2);

        assertEq(tokenA.balanceOf(address(fund)), rawBefore, "raw balance unchanged by a multiplier");
        assertEq(fund.scaledHoldings()[0], rawBefore * 2, "scaled holdings reflect the multiplier");
    }

    /// @dev THE double-count test. Chainlink returns Total Return Values that already include the
    ///      multiplier, so a multiplier change on its own must not move NAV by even one wei.
    ///      Getting this wrong inflates NAV by the multiplier factor.
    function test_navUnchangedByMultiplierAlone() public {
        _depositBalanced(alice, DEPOSIT);
        uint256 navBefore = fund.totalNAV();

        tokenA.updateUIMultiplier(2e18, block.timestamp + 1);
        vm.warp(block.timestamp + 2);

        assertEq(fund.totalNAV(), navBefore, "NAV must not move on a multiplier change alone");
        assertEq(fund.navPerShare(), 1e6, "NAV per share unchanged");
    }

    /// @dev A real dividend moves the TRV feed and the multiplier together. NAV must rise exactly
    ///      once — by the feed's move — never twice.
    function test_dividendRaisesNavExactlyOnce() public {
        _depositBalanced(alice, DEPOSIT);
        assertEq(fund.totalNAV(), 100e6);

        // +10% on both the TRV feed and the multiplier, as a reinvested dividend would.
        feedA.setAnswer(220e8);
        tokenA.updateUIMultiplier(1.1e18, block.timestamp + 1);
        vm.warp(block.timestamp + 2);

        // A: $50 -> $55. B unchanged at $50. Double-counting would give $110.
        assertEq(fund.totalNAV(), 105e6, "NAV rises exactly once");
    }

    /*//////////////////////////////////////////////////////////////
                    SECURITY — THE FUND CANNOT BE DRAINED
    //////////////////////////////////////////////////////////////*/

    function test_operatorFunctionsCannotMoveFunds() public {
        _depositBalanced(alice, DEPOSIT);
        uint256 aBefore = tokenA.balanceOf(address(fund));
        uint256 bBefore = tokenB.balanceOf(address(fund));
        uint256 cashBefore = usdc.balanceOf(address(fund));
        uint256 supplyBefore = share.totalSupply();
        uint256 operatorSharesBefore = share.balanceOf(address(this));

        // Every power the operator has, exercised at once.
        fund.setDepositsPaused(true);
        fund.setDriftThreshold(1_000);
        fund.setMinRebalanceInterval(3 days);
        fund.setMaxSlippage(300);
        fund.setCallerReward(25);
        fund.setStalenessTolerance(48 hours);
        fund.setCaps(1_000e6, 100_000e6);

        assertEq(tokenA.balanceOf(address(fund)), aBefore, "A untouched");
        assertEq(tokenB.balanceOf(address(fund)), bBefore, "B untouched");
        assertEq(usdc.balanceOf(address(fund)), cashBefore, "cash untouched");
        assertEq(share.totalSupply(), supplyBefore, "no shares minted or burned");
        assertEq(share.balanceOf(address(this)), operatorSharesBefore, "operator gained nothing");
    }

    /// @dev The previous version of this suite called the operator setters and asserted balances in
    ///      the same transaction, which never exercised the path that mattered: the operator can
    ///      also call the permissionless `rebalance`, and used to be paid a share of TOTAL NAV for
    ///      doing so. Maximising the three relevant knobs turned that into a standing income stream
    ///      out of the fund. The reward is now charged on traded value, so pushing the parameters to
    ///      their limits and churning the fund cannot extract more than the trade itself justifies.
    function test_operatorCannotFarmTheFundThroughRebalances() public {
        // Deposit leaving a cash sleeve, which by itself produces drift the operator can act on.
        uint256 perComponent = 40e6;
        uint256 units = _expectedUnits(perComponent, PRICE);
        tokenA.mint(address(router), units);
        tokenB.mint(address(router), units);
        uint256[] memory sellAmounts = new uint256[](2);
        sellAmounts[0] = perComponent;
        sellAmounts[1] = perComponent;
        bytes[] memory depositCalls = new bytes[](2);
        depositCalls[0] = _swapData(address(usdc), address(tokenA), perComponent, units);
        depositCalls[1] = _swapData(address(usdc), address(tokenB), perComponent, units);

        vm.startPrank(alice);
        usdc.approve(address(fund), DEPOSIT);
        fund.deposit(DEPOSIT, sellAmounts, depositCalls);
        vm.stopPrank();

        // Operator maximises every knob that governs how often and how richly it can be paid.
        fund.setCallerReward(100); // the ceiling
        fund.setMinRebalanceInterval(1 days); // the floor
        fund.setDriftThreshold(100); // the floor

        uint256 navBefore = fund.totalNAV();
        uint256 operatorBefore = usdc.balanceOf(address(this));

        vm.warp(block.timestamp + 2 days);
        _freshenFeeds();

        // The tightened threshold forces a more complete rebalance, so nearly all the cash goes in.
        uint256 buyEach = 9.5e6;
        uint256 unitsEach = _expectedUnits(buyEach, PRICE);
        tokenA.mint(address(router), unitsEach);
        tokenB.mint(address(router), unitsEach);
        int256[] memory amounts = new int256[](2);
        amounts[0] = int256(buyEach);
        amounts[1] = int256(buyEach);
        bytes[] memory calls = new bytes[](2);
        calls[0] = _swapData(address(usdc), address(tokenA), buyEach, unitsEach);
        calls[1] = _swapData(address(usdc), address(tokenB), buyEach, unitsEach);

        fund.rebalance(amounts, calls);

        uint256 taken = usdc.balanceOf(address(this)) - operatorBefore;
        uint256 traded = buyEach * 2;

        // Bounded by the trade, not by the fund: 1% of 15 USDC moved, not of the 100 USDC held.
        assertEq(taken, (traded * 100) / 10_000, "reward tracks traded value");
        assertLt(taken, navBefore / 100, "and is a small fraction of the fund, not a slice of it");
    }

    function test_operatorCannotMintShares() public {
        _depositBalanced(alice, DEPOSIT);
        // Only the fund contract holds MINT_ROLE on the share token — not the operator.
        vm.expectRevert();
        share.mint(address(this), 1e18);
    }

    /// @dev Shares are meant to be ordinary transferable tokens, composable with the rest of DeFi.
    ///      That only holds if nobody can freeze transfers: `PAUSE_ROLE` is never granted, and the
    ///      fund exposes no function that could grant it later.
    function test_shareTransfersCanNeverBeFrozen() public {
        bytes32 pauseRole = keccak256("PAUSE_ROLE");
        assertFalse(share.hasRole(pauseRole, address(fund)), "fund holds no pause role");
        assertFalse(share.hasRole(pauseRole, address(this)), "operator holds no pause role");

        IB20.PausableFeature[] memory features = new IB20.PausableFeature[](1);
        features[0] = IB20.PausableFeature.TRANSFER;
        vm.expectRevert();
        share.pause(features);

        // Transfer policies stay at the always-allow default, so holders can move shares freely.
        assertEq(share.policyId(keccak256("TRANSFER_SENDER_POLICY")), 0);
        assertEq(share.policyId(keccak256("TRANSFER_RECEIVER_POLICY")), 0);

        uint256 minted = _depositBalanced(alice, DEPOSIT);
        vm.prank(alice);
        share.transfer(bob, minted);
        assertEq(share.balanceOf(bob), minted, "shares move like any other token");
    }

    /// @dev The factory is permissionless, so a basket can be proposed by anyone. A repeated token
    ///      would be counted once per entry by every balance loop: NAV would double, and each
    ///      redemption iteration would re-read an already-reduced balance and pay out again,
    ///      letting a half-supply holder extract three quarters of it.
    function test_duplicateComponentIsRejectedAtConstruction() public {
        SlateFund.ComponentInput[] memory comps = new SlateFund.ComponentInput[](2);
        comps[0] = SlateFund.ComponentInput({token: address(tokenA), feed: address(feedA), targetWeightBps: 5_000, pool: address(0)});
        comps[1] = SlateFund.ComponentInput({token: address(tokenA), feed: address(feedA), targetWeightBps: 5_000, pool: address(0)});

        vm.expectRevert(abi.encodeWithSelector(SlateFund.DuplicateComponent.selector, address(tokenA)));
        new SlateFund(
            bytes32(uint256(77)), "Dup", "DUP", address(usdc), address(router), address(this), comps, "dup"
        );
    }

    /// @dev With supply at zero, any value left in the fund belongs to nobody — so the next
    ///      depositor would acquire all of it for the price of their own deposit.
    function test_depositRefusedWhileAssetsHaveNoOwner() public {
        // Strand value: freeze a component, then exit through the path that abandons it.
        uint256 shares = _depositBalanced(alice, DEPOSIT);
        tokenB.grantRole(keccak256("PAUSE_ROLE"), address(this));
        IB20.PausableFeature[] memory features = new IB20.PausableFeature[](1);
        features[0] = IB20.PausableFeature.TRANSFER;
        tokenB.pause(features);

        vm.startPrank(alice);
        share.approve(address(fund), shares);
        fund.redeemInKindSkippingBlocked(shares);
        vm.stopPrank();

        assertEq(share.totalSupply(), 0, "supply is gone");
        assertGt(fund.totalNAV(), 0, "but value remains");

        uint256[] memory sellAmounts = new uint256[](2);
        bytes[] memory calls = _emptyCalls();
        vm.startPrank(bob);
        usdc.approve(address(fund), 1e6);
        vm.expectRevert(
            abi.encodeWithSelector(SlateFund.FundHasOrphanedAssets.selector, fund.totalNAV())
        );
        fund.deposit(1e6, sellAmounts, calls); // 1 USDC would otherwise buy the whole residue
        vm.stopPrank();
    }

    /// @dev Burning a position in exchange for nothing must not be a successful transaction.
    function test_exitDeliveringNothingReverts() public {
        uint256 shares = _depositBalanced(alice, DEPOSIT);

        bytes32 pauseRole = keccak256("PAUSE_ROLE");
        IB20.PausableFeature[] memory features = new IB20.PausableFeature[](1);
        features[0] = IB20.PausableFeature.TRANSFER;
        tokenA.grantRole(pauseRole, address(this));
        tokenB.grantRole(pauseRole, address(this));
        tokenA.pause(features);
        tokenB.pause(features);

        vm.startPrank(alice);
        share.approve(address(fund), shares);
        vm.expectRevert(SlateFund.NothingDelivered.selector);
        fund.redeemInKindSkippingBlocked(shares);
        vm.stopPrank();

        assertEq(share.balanceOf(alice), shares, "the position survives a failed exit");
    }

    /// @dev The fund cap must track live value, not a running tally. Under the old accounting,
    ///      sending shares away and redeeming a sliver released the whole recorded deposit, so the
    ///      cap could be recycled indefinitely from one address while the exposure stayed in place.
    function test_fundCapHoldsWhenSharesAreShuffled() public {
        fund.setCaps(DEPOSIT, DEPOSIT); // room for exactly one deposit
        uint256 shares = _depositBalanced(alice, DEPOSIT);

        // Park the position elsewhere and redeem the smallest possible amount, which is what used
        // to zero the tally.
        vm.startPrank(alice);
        share.transfer(bob, shares - 1);
        share.approve(address(fund), 1);
        fund.redeemInKind(1);
        vm.stopPrank();

        assertEq(fund.depositedBy(alice), 0, "cost basis released, as before");
        assertApproxEqAbs(fund.totalNAV(), DEPOSIT, 2, "but the exposure never left the fund");

        // So no further deposit fits, from either address — each stopped by the cap that applies
        // to it. Alice now holds nothing, so her own cap has room and the fund cap is what binds.
        uint256[] memory sellAmounts = new uint256[](2);
        bytes[] memory calls = _emptyCalls();

        vm.startPrank(alice);
        usdc.approve(address(fund), 1e6);
        vm.expectRevert(SlateFund.ExceedsFundCap.selector);
        fund.deposit(1e6, sellAmounts, calls);
        vm.stopPrank();

        // Bob is carrying the whole position, so his per-wallet cap binds first.
        vm.startPrank(bob);
        usdc.approve(address(fund), 1e6);
        vm.expectRevert(SlateFund.ExceedsWalletCap.selector);
        fund.deposit(1e6, sellAmounts, calls);
        vm.stopPrank();
    }

    /// @dev A swap is judged against the oracle, so the reference price must be fresh even though
    ///      NAV tolerates a weekend-old close. Otherwise a caller trades against a stale mark.
    function test_swapsRequireAFresherPriceThanNav() public {
        _depositBalanced(alice, DEPOSIT);
        vm.warp(block.timestamp + 8 days);
        _freshenFeeds();

        // Age feed A past the swap window but well inside the NAV tolerance.
        feedA.setUpdatedAt(block.timestamp - 2 hours);
        (bool healthy,) = fund.feedsHealthy();
        assertTrue(healthy, "NAV still prices happily");
        assertGt(fund.totalNAV(), 0);

        feedA.setAnswer(PRICE * 2);
        feedA.setUpdatedAt(block.timestamp - 2 hours);

        uint256 sellRawA = 6_250_000;
        usdc.mint(address(router), 25e6);
        int256[] memory amounts = new int256[](2);
        amounts[0] = -int256(sellRawA);
        bytes[] memory calls = new bytes[](2);
        calls[0] = _swapData(address(tokenA), address(usdc), sellRawA, 25e6);

        vm.expectRevert(
            abi.encodeWithSelector(
                SlateFund.StaleFeed.selector, address(feedA), block.timestamp - 2 hours
            )
        );
        fund.rebalance(amounts, calls);
    }

    function test_nonOperatorCannotTouchParams() public {
        vm.prank(alice);
        vm.expectRevert(SlateFund.NotOperator.selector);
        fund.setDepositsPaused(true);
    }

    /// @dev The earlier version of this test could not fail: the probe re-entered during the very
    ///      first deposit, when supply was still zero, so the nested call died on `ZeroShares`
    ///      whether or not the guard existed. Seeding a position first means the nested call would
    ///      genuinely succeed if `nonReentrant` were removed.
    function test_reentrancyGuardIsWhatBlocksNestedEntry() public {
        MockReentrantRouter evil = new MockReentrantRouter();

        SlateFund.ComponentInput[] memory comps = new SlateFund.ComponentInput[](1);
        comps[0] = SlateFund.ComponentInput({token: address(tokenA), feed: address(feedA), targetWeightBps: 10_000, pool: address(0)});
        SlateFund evilFund = new SlateFund(
            bytes32(uint256(98)),
            "Reentrancy Probe Two",
            "PROBE2",
            address(usdc),
            address(evil),
            address(this),
            comps,
            "probe"
        );
        IB20Asset evilShare = evilFund.SHARE();

        // A real position exists before the probe fires, so supply > 0 at the moment of re-entry.
        uint256 units = _expectedUnits(DEPOSIT, PRICE);
        tokenA.mint(address(evil), units * 2);
        uint256[] memory sellAmounts = new uint256[](1);
        sellAmounts[0] = DEPOSIT;
        bytes[] memory calls = new bytes[](1);
        calls[0] = _swapData(address(usdc), address(tokenA), DEPOSIT, units);

        evil.arm(address(evilFund), "");
        vm.startPrank(alice);
        usdc.approve(address(evilFund), DEPOSIT * 2);
        evilFund.deposit(DEPOSIT, sellAmounts, calls);
        vm.stopPrank();

        assertGt(evilShare.totalSupply(), 0, "supply is live, so the nested call could succeed");

        // The re-entrant call arrives as the router, so the router itself must hold shares and have
        // approved the fund. Otherwise the nested redemption fails for lack of a balance and the
        // test passes whether or not the guard exists — which is exactly how the previous version
        // of this test fooled itself.
        uint256 probeShares = 1e18;
        vm.prank(alice);
        evilShare.transfer(address(evil), probeShares);
        vm.prank(address(evil));
        evilShare.approve(address(evilFund), type(uint256).max);

        evil.arm(address(evilFund), abi.encodeCall(SlateFund.redeemInKind, (probeShares)));

        vm.prank(alice);
        evilFund.deposit(DEPOSIT, sellAmounts, calls);

        assertTrue(evil.reentryAttempted(), "the probe fired");
        assertFalse(evil.reentrySucceeded(), "nonReentrant blocked it");
        assertEq(evilShare.balanceOf(address(evil)), probeShares, "the nested redemption did nothing");
    }

    function test_reentrancyGuardBlocksNestedEntry() public {
        MockReentrantRouter evil = new MockReentrantRouter();

        SlateFund.ComponentInput[] memory comps = new SlateFund.ComponentInput[](1);
        comps[0] = SlateFund.ComponentInput({token: address(tokenA), feed: address(feedA), targetWeightBps: 10_000, pool: address(0)});
        SlateFund evilFund = new SlateFund(
            bytes32(uint256(99)),
            "Reentrancy Probe",
            "PROBE",
            address(usdc),
            address(evil),
            address(this),
            comps,
            "probe"
        );

        // While a deposit is mid-flight, the router tries to re-enter the fund.
        evil.arm(address(evilFund), abi.encodeCall(SlateFund.redeemInKind, (1)));

        uint256 units = _expectedUnits(DEPOSIT, PRICE);
        tokenA.mint(address(evil), units);

        uint256[] memory sellAmounts = new uint256[](1);
        sellAmounts[0] = DEPOSIT;
        bytes[] memory calls = new bytes[](1);
        calls[0] = _swapData(address(usdc), address(tokenA), DEPOSIT, units);

        vm.startPrank(alice);
        usdc.approve(address(evilFund), DEPOSIT);
        evilFund.deposit(DEPOSIT, sellAmounts, calls);
        vm.stopPrank();

        assertTrue(evil.reentryAttempted(), "the probe actually fired");
        assertFalse(evil.reentrySucceeded(), "nonReentrant blocked the nested call");
    }

    /// @dev At oracle-fair prices with no price movement, NAV per share must stay pinned
    ///      regardless of deposit sizing — no value leaks between holders.
    function testFuzz_navPerShareStableAcrossDeposits(uint256 first, uint256 second) public {
        first = bound(first, 2e6, 400e6);
        second = bound(second, 2e6, 400e6);
        first = first - (first % 2); // keep the 50/50 split exact
        second = second - (second % 2);

        _depositBalanced(alice, first);
        assertApproxEqAbs(fund.navPerShare(), 1e6, 1, "NAV per share after first deposit");

        _depositBalanced(bob, second);
        assertApproxEqAbs(fund.navPerShare(), 1e6, 1, "NAV per share after second deposit");
        // Each leg truncates to whole component units, so a deposit can lose sub-unit dust to
        // rounding — never more, and never in a holder's favour.
        assertLe(fund.totalNAV(), first + second, "NAV never exceeds what was deposited");
        assertApproxEqAbs(fund.totalNAV(), first + second, 4, "NAV tracks deposits within rounding");
    }
}
