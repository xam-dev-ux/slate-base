// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal settable mock of Pyth's pull-oracle read path, matching the subset of the
///         interface `SlateFund` actually calls.
contract MockPyth {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    mapping(bytes32 => Price) internal _prices;

    function setPrice(bytes32 id, int64 price, int32 expo) external {
        _prices[id] = Price({price: price, conf: 0, expo: expo, publishTime: block.timestamp});
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory) {
        return _prices[id];
    }
}
