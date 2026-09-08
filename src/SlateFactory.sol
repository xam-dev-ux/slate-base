// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {SlateFund} from "./SlateFund.sol";

/// @title SlateFactory
/// @notice Permissionless deployer of `SlateFund` instances. Anyone can launch their own index;
///         the caller of `createFund` becomes that fund's operator (bounded powers only — see
///         `SlateFund`). The factory holds no privileges over funds it did not create and none
///         over funds it did.
contract SlateFactory {
    address public immutable USDC;
    address public immutable SWAP_ROUTER;

    address[] public funds;
    mapping(address => bool) public isFund;

    event FundCreated(
        address indexed fund, address indexed shareToken, string name, string symbol, address operator
    );

    error OutOfRange();

    constructor(address usdc, address swapRouter) {
        USDC = usdc;
        SWAP_ROUTER = swapRouter;
    }

    /// @notice Deploys a new `SlateFund` with `msg.sender` as its operator.
    function createFund(
        bytes32 salt,
        string calldata shareName,
        string calldata shareSymbol,
        SlateFund.ComponentInput[] calldata components,
        string calldata indexRule
    ) external returns (address fund) {
        SlateFund newFund =
            new SlateFund(salt, shareName, shareSymbol, USDC, SWAP_ROUTER, msg.sender, components, indexRule);
        fund = address(newFund);

        funds.push(fund);
        isFund[fund] = true;

        emit FundCreated(fund, address(newFund.SHARE()), shareName, shareSymbol, msg.sender);
    }

    function fundCount() external view returns (uint256) {
        return funds.length;
    }

    function fundsPage(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 total = funds.length;
        if (offset > total) revert OutOfRange();
        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = funds[i];
        }
    }
}
