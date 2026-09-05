// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IB20} from "base-std/interfaces/IB20.sol";

/// @notice Stand-in for the 0x AllowanceHolder router in unit tests. Pulls `amountIn` of
///         `tokenIn` from the caller (who must have approved this contract, exactly like the
///         real AllowanceHolder flow) and pays out a caller-specified `amountOut` of `tokenOut`
///         from its own pre-funded balance. Lets tests dial in an exact swap outcome —
///         including a deliberately bad rate to exercise `SlateFund`'s slippage check.
contract MockRouter {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) external {
        IB20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IB20(tokenOut).transfer(msg.sender, amountOut);
    }
}
