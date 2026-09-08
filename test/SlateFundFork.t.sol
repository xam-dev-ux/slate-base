// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SlateFund} from "../src/SlateFund.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Asset} from "base-std/interfaces/IB20Asset.sol";

interface IAggregatorV3Fork {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

/// @dev Fork tests against real Base mainnet state: real Coinbase Tokenized Stocks, real Chainlink
///      TRV feeds, the real B20 factory precompile, and real Aerodrome pools used as token sources.
///
///      Pinned to block 50878627 (2026-09-04 18:30:01 UTC, Friday post-market) so results are
///      deterministic. At that block every component feed had published within the prior ~4 hours.
///
///      Run with: base-forge test --fork-url https://mainnet.base.org --match-contract Fork
contract SlateFundForkTest is Test {
    uint256 internal constant FORK_BLOCK = 50_878_627;

    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    address internal constant NVDAC = 0xb20000000000000000000078ee7ce2fE4908108C;
    address internal constant AAPLC = 0xb200000000000000000000C2e324d24d7eEcd1fb;
    address internal constant METAC = 0xb2000000000000000000008bC8786B856E61707C;
    address internal constant GOOGLC = 0xb2000000000000000000002D0BA3164cc74f58B7;

    address internal constant NVDAC_FEED = 0x04689a41629776563E6822F76f2e57D148d28513;
    address internal constant AAPLC_FEED = 0x787f13dEa48Db0897CbCDD985de77809D837F988;
    address internal constant METAC_FEED = 0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D;
    address internal constant GOOGLC_FEED = 0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2;

    // Aerodrome Slipstream pools — a source of real tokens for seeding, and the TWAP fallback
    // backing each component (see test_fork_twapFallback below).
    address internal constant NVDAC_POOL = 0x853F5f1B92b16714Fe6CDA67CAad0856B83C7ab9;
    address internal constant AAPLC_POOL = 0xA3b1E3f9747065e2073722Ff4c9027d3eA4994F0;
    address internal constant METAC_POOL = 0xEAF57753BC382E0324a1D43F72E7027705a2273E;
    address internal constant GOOGLC_POOL = 0xB1987CAD1682841b4b641d50E520777eC5Ab5542;

    SlateFund internal fund;
    IB20Asset internal share;

    address internal alice = address(0xA11CE);

    function setUp() public {
        vm.createSelectFork(vm.envOr("MAINNET_RPC_URL", string("https://mainnet.base.org")), FORK_BLOCK);

        SlateFund.ComponentInput[] memory comps = new SlateFund.ComponentInput[](4);
        comps[0] =
            SlateFund.ComponentInput({token: NVDAC, feed: NVDAC_FEED, targetWeightBps: 2_500, pool: NVDAC_POOL});
        comps[1] =
            SlateFund.ComponentInput({token: AAPLC, feed: AAPLC_FEED, targetWeightBps: 2_500, pool: AAPLC_POOL});
        comps[2] =
            SlateFund.ComponentInput({token: METAC, feed: METAC_FEED, targetWeightBps: 2_500, pool: METAC_POOL});
        comps[3] =
            SlateFund.ComponentInput({token: GOOGLC, feed: GOOGLC_FEED, targetWeightBps: 2_500, pool: GOOGLC_POOL});

        fund = new SlateFund(
            keccak256("slate.fork.test"),
            "Slate Big Tech 4",
            "SLATE4",
            USDC,
            0x0000000000001fF3684f28c67538d4D072C22734, // 0x AllowanceHolder on Base
            address(this),
            comps,
            "Equal-weight basket of the four Coinbase Tokenized Stocks with established onchain liquidity.",
            SlateFund.ProtectionConfig({
                sequencerUptimeFeed: address(0),
                pyth: address(0),
                protocolFeeRecipient: address(0),
                protocolFeeBps: 0
            })
        );
        share = fund.SHARE();
    }

    function _tokens() internal pure returns (address[4] memory) {
        return [NVDAC, AAPLC, METAC, GOOGLC];
    }

    function _pools() internal pure returns (address[4] memory) {
        return [NVDAC_POOL, AAPLC_POOL, METAC_POOL, GOOGLC_POOL];
    }

    function _feeds() internal pure returns (address[4] memory) {
        return [NVDAC_FEED, AAPLC_FEED, METAC_FEED, GOOGLC_FEED];
    }

    /// @dev Sources real tokens from the Aerodrome pools that hold them.
    function _seedFund(uint256 rawPerComponent) internal {
        address[4] memory tokens = _tokens();
        address[4] memory pools = _pools();
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(pools[i]);
            IB20(tokens[i]).transfer(address(fund), rawPerComponent);
        }
    }

    /*//////////////////////////////////////////////////////////////
                          REAL TOKEN PROPERTIES
    //////////////////////////////////////////////////////////////*/

    /// @dev Every Coinbase Tokenized Stock is 8 decimals, and none has ever rebased — multiplier is
    ///      still exactly 1e18. The multiplier path therefore cannot be exercised against real
    ///      tokens; only the mocked unit tests cover it. Stated here rather than assumed.
    function test_fork_realTokensAre8DecimalsAndNeverRebased() public view {
        address[4] memory tokens = _tokens();
        for (uint256 i = 0; i < 4; i++) {
            assertEq(IB20(tokens[i]).decimals(), 8, "component is 8 decimals");
            assertEq(IB20Asset(tokens[i]).multiplier(), 1e18, "multiplier still unity");
        }
        assertEq(IB20(USDC).decimals(), 6, "USDC is 6 decimals");
    }

    /// @dev The product only works if an arbitrary contract can custody these tokens. Real cbXXX
    ///      carry policy ID 5 on every transfer scope; this proves it behaves as a blocklist
    ///      (permissive by default) rather than an allowlist, so the fund can hold them.
    function test_fork_contractCanCustodyPolicyGatedTokens() public {
        address[4] memory tokens = _tokens();
        uint256 amount = 1e8; // one whole share-equivalent

        _seedFund(amount);

        for (uint256 i = 0; i < 4; i++) {
            assertEq(IB20(tokens[i]).balanceOf(address(fund)), amount, "fund custodies the component");
        }
    }

    /*//////////////////////////////////////////////////////////////
                        NAV AGAINST REAL ORACLES
    //////////////////////////////////////////////////////////////*/

    /// @dev NAV must equal the independently computed sum of (real balance x real TRV price), with
    ///      the multiplier applied exactly once — i.e. not at all here, because the feed already
    ///      carries it.
    function test_fork_navMatchesRealFeedPrices() public {
        uint256 amount = 1e8;
        _seedFund(amount);

        address[4] memory feeds = _feeds();
        uint256 expectedNav;
        for (uint256 i = 0; i < 4; i++) {
            (, int256 answer,,,) = IAggregatorV3Fork(feeds[i]).latestRoundData();
            assertGt(answer, 0, "feed has a positive price");
            // 8dp balance * 8dp price -> 6dp USDC terms
            expectedNav += (amount * uint256(answer) * 1e6) / 1e16;
        }

        assertEq(fund.totalNAV(), expectedNav, "NAV matches oracle-derived value");
        emit log_named_uint("fork NAV (6dp USDC)", fund.totalNAV());
    }

    /// @dev With the multiplier at unity, scaled holdings equal raw balances. This is the real-world
    ///      baseline the double-count test protects.
    function test_fork_scaledHoldingsEqualRawAtUnityMultiplier() public {
        uint256 amount = 1e8;
        _seedFund(amount);

        uint256[] memory scaled = fund.scaledHoldings();
        address[4] memory tokens = _tokens();
        for (uint256 i = 0; i < 4; i++) {
            assertEq(scaled[i], IB20(tokens[i]).balanceOf(address(fund)), "scaled == raw at 1e18");
        }
    }

    /*//////////////////////////////////////////////////////////////
                        FEED STALENESS, MEASURED
    //////////////////////////////////////////////////////////////*/

    /// @dev Feeds are 24/5 and update on deviation/heartbeat, so even mid-session a component can be
    ///      hours behind. Logs the real gap at the pinned block to justify the tolerance setting.
    function test_fork_feedsHealthyAndReportRealStaleness() public {
        (bool healthy, address staleFeed) = fund.feedsHealthy();
        assertTrue(healthy, "all feeds within tolerance at the pinned block");
        assertEq(staleFeed, address(0));

        address[4] memory feeds = _feeds();
        for (uint256 i = 0; i < 4; i++) {
            (,,, uint256 updatedAt,) = IAggregatorV3Fork(feeds[i]).latestRoundData();
            emit log_named_uint("feed staleness (minutes)", (block.timestamp - updatedAt) / 60);
            assertEq(IAggregatorV3Fork(feeds[i]).decimals(), 8, "TRV feed is 8 decimals");
        }
    }

    /// @dev Past the tolerance the fund refuses to price itself — correct behaviour, not a bug.
    function test_fork_navRevertsWhenFeedsGoStale() public {
        _seedFund(1e8);
        assertGt(fund.totalNAV(), 0);

        // Roll past the operator ceiling with no new rounds published, as happens over a weekend.
        vm.warp(block.timestamp + 73 hours);

        vm.expectRevert();
        fund.totalNAV();
    }

    /// @dev Same stale-past-73h scenario as above, but with the TWAP fallback opted into — proves
    ///      it's genuinely off by default (the previous test already established that reverts) and
    ///      that turning it on recovers a real, sane price from the pool's own oracle rather than
    ///      the fund just staying frozen.
    function test_fork_navUsesTwapWhenFallbackEnabled() public {
        _seedFund(1e8);
        uint256 navBeforeStale = fund.totalNAV();

        vm.warp(block.timestamp + 73 hours);
        vm.expectRevert();
        fund.totalNAV();

        fund.setTwapFallbackEnabled(true);

        uint256 navAfter = fund.totalNAV();
        assertGt(navAfter, 0, "TWAP fallback should produce a positive NAV");

        // The pool's own state is exactly as pinned (only block.timestamp moved), so the TWAP
        // reflects the same liquidity distribution as before the warp — sanity-bound against the
        // pre-stale NAV rather than asserting exact equality, since it's a genuinely different
        // pricing source (pool TWAP vs Chainlink spot).
        assertApproxEqRel(navAfter, navBeforeStale, 0.05e18, "TWAP-derived NAV within 5% of oracle NAV");
    }

    /*//////////////////////////////////////////////////////////////
                     SHARE TOKEN VIA THE REAL PRECOMPILE
    //////////////////////////////////////////////////////////////*/

    function test_fork_shareTokenCreatedThroughRealFactory() public view {
        assertEq(IB20(address(share)).name(), "Slate Big Tech 4");
        assertEq(IB20(address(share)).symbol(), "SLATE4");
        assertEq(IB20(address(share)).decimals(), 18);
        assertEq(IB20Asset(address(share)).multiplier(), 1e18);

        // The fund holds exactly the roles it needs, and the metadata it published is readable.
        assertTrue(IB20(address(share)).hasRole(keccak256("MINT_ROLE"), address(fund)));
        assertTrue(IB20(address(share)).hasRole(keccak256("BURN_ROLE"), address(fund)));
        assertTrue(IB20(address(share)).hasRole(keccak256("OPERATOR_ROLE"), address(fund)));
        assertEq(
            IB20Asset(address(share)).extraMetadata("rebalance_policy"), "threshold-based, permissionless"
        );
    }

    /*//////////////////////////////////////////////////////////////
                    IN-KIND EXIT WITH REAL COMPONENTS
    //////////////////////////////////////////////////////////////*/

    /// @dev The unconditional exit, exercised against real tokens and with every real feed stale.
    function test_fork_redeemInKindReturnsRealTokens() public {
        // Deposit into the empty fund first. Seeding components beforehand would leave assets with
        // no supply behind them, which deposits now refuse rather than hand to the next arrival.
        uint256 cash = 100e6;
        deal(USDC, alice, cash);

        uint256[] memory sellAmounts = new uint256[](4);
        bytes[] memory calls = new bytes[](4);

        vm.startPrank(alice);
        IB20(USDC).approve(address(fund), cash);
        fund.deposit(cash, sellAmounts, calls);
        vm.stopPrank();

        // Now put real components behind those shares.
        uint256 amount = 1e8;
        _seedFund(amount);

        uint256 shares = share.balanceOf(alice);
        assertGt(shares, 0, "deposit minted shares");

        // Now freeze every feed and prove the exit still works.
        vm.warp(block.timestamp + 100 hours);

        vm.startPrank(alice);
        share.approve(address(fund), shares);
        fund.redeemInKind(shares);
        vm.stopPrank();

        address[4] memory tokens = _tokens();
        for (uint256 i = 0; i < 4; i++) {
            assertGt(IB20(tokens[i]).balanceOf(alice), 0, "alice received real underlying");
        }
        assertEq(share.balanceOf(alice), 0, "shares burned");
    }
}
