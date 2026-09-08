// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {TickMath} from "./TickMath.sol";

interface ICLPoolObserve {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

/// @notice Reads a manipulation-resistant time-weighted average price straight from an Aerodrome
///         Slipstream pool's own oracle, as a fallback for when Chainlink is stale. A momentary
///         spot-price manipulation barely moves an average taken over a real window (minutes), which
///         is the whole reason this exists instead of just trusting the pool's current tick.
library TwapOracle {
    /// @dev Every pool this fund trades against has USDC as token0. Assumed here, not detected —
    ///      an option accepting arbitrary pools would need to branch on token0/token1 as well.
    uint8 internal constant USDC_DECIMALS = 6;

    /// @notice A Chainlink-TRV-shaped answer (scaled by 10**feedDecimals) derived from the pool's
    ///         TWAP over the last `window` seconds, expressed in the same units
    ///         `SlateFund._quoteComponentToUsdc`/`_quoteUsdcToComponent` already expect.
    function twapAnswer(address pool, uint32 window, uint8 componentDecimals, uint8 feedDecimals)
        internal
        view
        returns (uint256 answer)
    {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives,) = ICLPoolObserve(pool).observe(secondsAgos);
        int56 delta = tickCumulatives[1] - tickCumulatives[0];
        int56 windowInt = int56(uint56(window));

        int24 avgTick = int24(delta / windowInt);
        // Round toward negative infinity for a negative, non-exact delta, matching Uniswap's own
        // OracleLibrary — Solidity's division truncates toward zero, which would otherwise round
        // a negative average the wrong way.
        if (delta < 0 && delta % windowInt != 0) avgTick -= 1;

        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(avgTick);

        // price (raw token1 per raw token0) = (sqrtPriceX96 / 2^96)^2. We want its reciprocal,
        // rescaled from raw units to a feedDecimals-scaled USD price — see the derivation in
        // SlateFund's TWAP integration notes. Split into two divisions by sqrtPriceX96 rather than
        // squaring it outright, so the intermediate never needs the full 192-bit width that would
        // take (real sqrtPriceX96 values are far below the range where this would matter, but the
        // split costs nothing and removes the question).
        uint256 numerator = 10 ** (uint256(componentDecimals) + uint256(feedDecimals) - USDC_DECIMALS);
        uint256 step = (numerator << 96) / sqrtPriceX96;
        answer = (step << 96) / sqrtPriceX96;
    }
}
