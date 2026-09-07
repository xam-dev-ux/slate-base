// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SlateFund} from "../src/SlateFund.sol";

/// @notice Canonical Base mainnet addresses and basket definitions, verified on-chain 2026-09-05.
///         Liquidity was re-measured on the day rather than taken from launch-day figures: only
///         these four Coinbase Tokenized Stocks clear a sub-1% price impact at 1000 USDC (all are
///         under 0.2%). COINc, CRCLc and INTCc have no pool on any Base DEX at all.
library SlateAddresses {
    /*//////////////////////////////////////////////////////////////
                              INFRASTRUCTURE
    //////////////////////////////////////////////////////////////*/

    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    /// @notice Aerodrome Slipstream SwapRouter on Base. 0x's API rejects every Coinbase Tokenized
    ///         Stock with `BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE` (their compliance restriction, not
    ///         ours), so swaps route directly against the real liquidity venue instead. Aerodrome
    ///         runs multiple CL factory generations at once — this is the SwapRouter whose
    ///         `factory()` actually matches the pools in `docs/research-phase0.md`
    ///         (`0xf8f2eB49...c061Ef`), confirmed on-chain and against a real fork swap, not the
    ///         older SwapRouter bound to Aerodrome's `legacyCLFactory`. The fund treats it as the
    ///         sole call target and validates every outcome against Chainlink regardless.
    address internal constant AERODROME_SWAP_ROUTER = 0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F;

    /*//////////////////////////////////////////////////////////////
                          COMPONENTS AND FEEDS
    //////////////////////////////////////////////////////////////*/

    address internal constant NVDAC = 0xb20000000000000000000078ee7ce2fE4908108C;
    address internal constant AAPLC = 0xb200000000000000000000C2e324d24d7eEcd1fb;
    address internal constant METAC = 0xb2000000000000000000008bC8786B856E61707C;
    address internal constant GOOGLC = 0xb2000000000000000000002D0BA3164cc74f58B7;

    address internal constant NVDAC_FEED = 0x04689a41629776563E6822F76f2e57D148d28513;
    address internal constant AAPLC_FEED = 0x787f13dEa48Db0897CbCDD985de77809D837F988;
    address internal constant METAC_FEED = 0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D;
    address internal constant GOOGLC_FEED = 0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2;

    /*//////////////////////////////////////////////////////////////
                                BASKETS
    //////////////////////////////////////////////////////////////*/

    /// @notice Slate Big Tech 4 — equal weight across all four liquid components.
    function bigTech4() internal pure returns (SlateFund.ComponentInput[] memory comps) {
        comps = new SlateFund.ComponentInput[](4);
        comps[0] = SlateFund.ComponentInput({token: NVDAC, feed: NVDAC_FEED, targetWeightBps: 2_500});
        comps[1] = SlateFund.ComponentInput({token: AAPLC, feed: AAPLC_FEED, targetWeightBps: 2_500});
        comps[2] = SlateFund.ComponentInput({token: METAC, feed: METAC_FEED, targetWeightBps: 2_500});
        comps[3] = SlateFund.ComponentInput({token: GOOGLC, feed: GOOGLC_FEED, targetWeightBps: 2_500});
    }

    /// @notice Slate AI Core — concentrated toward AI infrastructure and applications.
    function aiCore() internal pure returns (SlateFund.ComponentInput[] memory comps) {
        comps = new SlateFund.ComponentInput[](3);
        comps[0] = SlateFund.ComponentInput({token: NVDAC, feed: NVDAC_FEED, targetWeightBps: 4_000});
        comps[1] = SlateFund.ComponentInput({token: GOOGLC, feed: GOOGLC_FEED, targetWeightBps: 3_000});
        comps[2] = SlateFund.ComponentInput({token: METAC, feed: METAC_FEED, targetWeightBps: 3_000});
    }

    string internal constant BIG_TECH_4_RULE =
        "Equal-weight basket of the four US technology companies available as Coinbase Tokenized Stocks with established onchain liquidity. Rebalanced when any component drifts more than 5 percentage points from its 25% target.";

    string internal constant AI_CORE_RULE =
        "Concentrated basket weighted toward companies with primary revenue exposure to artificial intelligence infrastructure and applications.";
}
