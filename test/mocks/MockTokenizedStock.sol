// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {B20Constants} from "base-std/lib/B20Constants.sol";
import {B20FactoryLib} from "base-std/lib/B20FactoryLib.sol";
import {IB20Asset} from "base-std/interfaces/IB20Asset.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";

/// @notice Deploys a real B20 Asset through the live factory precompile (`base-forge` hosts it
///         in-process, so this is not a hand-rolled fake) and grants `admin` MINT_ROLE,
///         BURN_ROLE, and OPERATOR_ROLE, so tests can seed balances and fire
///         `updateUIMultiplier` directly. Real Coinbase Tokenized Stocks have never rebased on
///         mainnet, so this is the only way to exercise the multiplier path.
library MockTokenizedStock {
    function deploy(bytes32 salt, string memory name, string memory symbol, uint8 decimals, address admin)
        internal
        returns (IB20Asset token)
    {
        bytes memory params = B20FactoryLib.encodeAssetCreateParams(name, symbol, admin, decimals);
        bytes[] memory initCalls = new bytes[](3);
        initCalls[0] = B20FactoryLib.encodeGrantRole(B20Constants.MINT_ROLE, admin);
        initCalls[1] = B20FactoryLib.encodeGrantRole(B20Constants.BURN_ROLE, admin);
        initCalls[2] = B20FactoryLib.encodeGrantRole(B20Constants.OPERATOR_ROLE, admin);
        address t = StdPrecompiles.B20_FACTORY.createB20(IB20Factory.B20Variant.ASSET, salt, params, initCalls);
        token = IB20Asset(t);
    }
}
