// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal settable Chainlink-compatible aggregator for NAV and staleness tests. Real
///         Chainlink feeds on Base are 24/5 and hold the last close outside market sessions —
///         `setUpdatedAt` lets tests simulate that gap without waiting real time.
contract MockAggregator {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 private _roundId;

    constructor(uint8 decimals_, int256 initialAnswer) {
        decimals = decimals_;
        answer = initialAnswer;
        updatedAt = block.timestamp;
        _roundId = 1;
    }

    function setAnswer(int256 newAnswer) external {
        answer = newAnswer;
        updatedAt = block.timestamp;
        _roundId++;
    }

    function setUpdatedAt(uint256 timestamp) external {
        updatedAt = timestamp;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 ans, uint256 startedAt, uint256 updatedAt_, uint80 answeredInRound)
    {
        return (_roundId, answer, updatedAt, updatedAt, _roundId);
    }
}
