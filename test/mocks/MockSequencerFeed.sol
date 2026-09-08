// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal settable mock of Chainlink's L2 sequencer uptime feed. `answer` is 0 for up,
///         1 for down — the opposite convention from a price feed, matching the real thing.
contract MockSequencerFeed {
    int256 public answer;
    uint256 public startedAt;

    constructor() {
        answer = 0; // up
        startedAt = block.timestamp;
    }

    function setStatus(bool down, uint256 startedAt_) external {
        answer = down ? int256(1) : int256(0);
        startedAt = startedAt_;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 ans, uint256 startedAt_, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, answer, startedAt, startedAt, 1);
    }
}
