// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IB20} from "base-std/interfaces/IB20.sol";

/// @notice A router that re-enters the fund mid-swap, to prove the `nonReentrant` guards hold.
///         `reentryCalldata` is invoked against `fund` from inside the swap, i.e. while the
///         fund's own external entry point is still on the stack.
contract MockReentrantRouter {
    address public fund;
    bytes public reentryCalldata;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    function arm(address fund_, bytes calldata reentryCalldata_) external {
        fund = fund_;
        reentryCalldata = reentryCalldata_;
        reentryAttempted = false;
        reentrySucceeded = false;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) external {
        IB20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        reentryAttempted = true;
        (bool ok,) = fund.call(reentryCalldata);
        reentrySucceeded = ok;

        IB20(tokenOut).transfer(msg.sender, amountOut);
    }
}
