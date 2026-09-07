// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {B20Constants} from "base-std/lib/B20Constants.sol";
import {B20FactoryLib} from "base-std/lib/B20FactoryLib.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Asset} from "base-std/interfaces/IB20Asset.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";
import {TwapOracle} from "./libraries/TwapOracle.sol";

interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

/// @title SlateFund
/// @notice Onchain index fund over a fixed basket of Coinbase Tokenized Stocks (B20 assets).
///         Custodies the underlying components, mints/burns a B20 share token 1:1 with NAV,
///         and rebalances permissionlessly when a component drifts beyond threshold. The
///         operator can pause deposits and tune bounded parameters; it can never move funds.
contract SlateFund {
    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    /// @notice Constructor-supplied component definition. Decimals are derived on-chain in the
    ///         constructor rather than trusted from the deployer, so a bad deploy-script value
    ///         can't poison NAV math.
    struct ComponentInput {
        address token;
        address feed;
        uint16 targetWeightBps;
        /// @notice Aerodrome Slipstream pool (component/USDC) backing the TWAP fallback below.
        ///         address(0) if none is configured — that component simply has no fallback and
        ///         still reverts on a stale feed regardless of `twapFallbackEnabled`.
        address pool;
    }

    /// @notice Stored component definition, decimals cached at construction (immutable per B20/
    ///         Chainlink semantics, so caching avoids a repeated external call on every NAV read).
    struct Component {
        address token;
        address feed;
        uint16 targetWeightBps;
        uint8 tokenDecimals;
        uint8 feedDecimals;
        address pool;
    }

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    IB20Asset public immutable SHARE;
    address public immutable USDC;
    address public immutable SWAP_ROUTER;
    address public immutable OPERATOR;

    Component[] public components;

    // Rebalance parameters — operator-settable within hard bounds; never a fund-drain vector.
    uint16 public driftThresholdBps = 500; // 5 percentage points
    uint32 public minRebalanceInterval = 7 days;
    uint16 public maxSlippageBps = 200; // 2%
    /// @notice Caller reward, charged on the value actually traded — never on total NAV. Rewarding
    ///         a share of the whole fund would let anyone who can manufacture drift (idle cash is
    ///         enough) collect a fee far larger than the work performed, including the operator,
    ///         who can move the parameters that decide when a rebalance is allowed.
    uint16 public callerRewardBps = 25; // 0.25% of traded value
    // Calibrated from live Chainlink data: the NVDAc feed observed a ~20h gap by Saturday
    // afternoon alone, and 24/5 feeds hold the Friday close across the whole weekend — a
    // Monday pre-market reopen can be 60-70h out. Tolerance sits near the 72h operator ceiling
    // so the fund doesn't freeze every weekend; see docs for the UX tradeoff this implies.
    uint32 public feedStalenessTolerance = 72 hours;
    /// @notice Separate, much tighter bound for prices used to validate a swap. NAV may be priced
    ///         off a weekend-old close because the alternative is freezing the fund, but accepting
    ///         a three-day-old price as the reference for "is this trade fair" would let a caller
    ///         trade against a stale mark at everyone else's expense.
    uint32 public swapPriceMaxAge = 1 hours;

    /// @notice Off by default — a fresh deploy behaves exactly like a fund with no fallback at all.
    ///         When the operator turns this on, a stale Chainlink feed no longer hard-blocks
    ///         pricing/swaps for a component with a configured pool: the fund instead prices that
    ///         component off the pool's own TWAP (see `libraries/TwapOracle.sol`), trading some
    ///         manipulation resistance (a real time-weighted average, not spot) for availability
    ///         during a genuine multi-day oracle gap. This is a real security tradeoff, not a
    ///         convenience toggle — it exists because Base/Aerodrome keep these markets liquid
    ///         24/7 even when Chainlink hasn't updated, so "no fresh oracle" and "no fair price
    ///         available" are not actually the same condition here.
    bool public twapFallbackEnabled;
    /// @notice TWAP averaging window, bounded so it can't be shrunk to something a flash-loan-sized
    ///         trade could meaningfully move, nor widened so far it stops reflecting anything
    ///         recent.
    uint32 public twapWindow = 30 minutes;

    uint64 public lastRebalanceAt;
    uint256 public rebalanceCount;

    /// @notice Caps bound live exposure, measured as the current value of a position and of the
    ///         fund. Cumulative-deposit accounting cannot work here: shares are transferable, so
    ///         any per-wallet tally is both evadable (send shares away, redeem, get the allowance
    ///         back) and ratchetable (a recipient redeems, and the tally is never released).
    uint256 public maxPositionPerWallet = 500e6;
    uint256 public maxFundValue = 25_000e6;

    /// @notice Cost basis, for display only. Never used to gate a deposit.
    uint256 public totalDeposited;
    mapping(address => uint256) public depositedBy;

    bool public depositsPaused;

    uint256 private _reentrancyLock = 1;

    /// @dev Refused rather than attempted below this, so a gas shortfall cannot be mistaken for a
    ///      component freeze and turned into a permanent forfeiture. A B20 transfer costs well
    ///      under this even with a policy-registry lookup.
    uint256 private constant GAS_FLOOR_PER_TRANSFER = 150_000;

    /// @dev Hard ceiling on the operator-settable fund cap. The caps are the compensating control
    ///      for an unaudited contract; the operator may tune them, not remove them.
    uint256 private constant MAX_FUND_VALUE_CEILING = 1_000_000e6;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event Deposited(address indexed user, uint256 usdcIn, uint256 sharesOut, uint256 navPerShare);
    event Redeemed(address indexed user, uint256 sharesIn, uint256 usdcOut, uint256 navPerShare);
    event RedeemedInKind(address indexed user, uint256 sharesIn);
    /// @dev `blocked` lists components the holder could not receive and therefore gave up.
    event RedeemedInKindPartial(address indexed user, uint256 sharesIn, address[] blocked);
    event Rebalanced(
        uint256 indexed rebalanceId,
        address indexed caller,
        string reason,
        uint256 navBefore,
        uint256 navAfter,
        uint256 callerReward
    );
    event ParamsUpdated(string param, uint256 oldValue, uint256 newValue);
    event DepositsPausedSet(bool paused);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotOperator();
    error DepositsArePaused();
    error ExceedsWalletCap();
    error ExceedsFundCap();
    error RebalanceTooSoon();
    error NoDriftDetected();
    error SlippageExceeded(address token, uint256 expected, uint256 actual);
    error StaleFeed(address feed, uint256 updatedAt);
    error ZeroShares();
    error LengthMismatch();
    error InvalidTotalWeight();
    error SwapCalldataInvalid(uint256 componentIndex);
    error SwapFailed(uint256 componentIndex);
    error ComponentNotOverweight(uint256 componentIndex);
    error ComponentNotUnderweight(uint256 componentIndex);
    error OverSell(uint256 componentIndex);
    error OverBuy(uint256 componentIndex);
    error DriftNotResolved(uint256 remainingDriftBps);
    error ReentrantCall();
    error OutOfBounds();
    error DuplicateComponent(address token);
    error UnsupportedDecimals(address token, uint8 decimals);
    error AllocationExceedsDeposit();
    /// @dev Supply is zero while assets remain, so those assets have no owner. Whoever deposited
    ///      next would take them, so deposits stop instead. Deploy a fresh fund.
    error FundHasOrphanedAssets(uint256 strandedValue);
    error NothingDelivered();
    error InsufficientGasForTransfer(address token);

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOperator() {
        if (msg.sender != OPERATOR) revert NotOperator();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyLock != 1) revert ReentrantCall();
        _reentrancyLock = 2;
        _;
        _reentrancyLock = 1;
    }

    /*//////////////////////////////////////////////////////////////
                               CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        bytes32 salt,
        string memory shareName,
        string memory shareSymbol,
        address usdc,
        address swapRouter,
        address operator,
        ComponentInput[] memory initialComponents,
        string memory indexRuleDescription
    ) {
        USDC = usdc;
        SWAP_ROUTER = swapRouter;
        OPERATOR = operator;

        uint16 totalWeight;
        for (uint256 i = 0; i < initialComponents.length; i++) {
            ComponentInput memory ci = initialComponents[i];

            // A repeated token would be counted once per entry by every balance loop, so NAV would
            // double and each redemption iteration would re-read an already-reduced balance and pay
            // out again. Anyone can deploy a fund through the factory, so this must be rejected
            // here rather than assumed away.
            for (uint256 j = 0; j < i; j++) {
                if (components[j].token == ci.token) revert DuplicateComponent(ci.token);
            }

            uint8 tokenDecimals = IB20(ci.token).decimals();
            uint8 feedDecimals = IAggregatorV3(ci.feed).decimals();
            // `10 ** (tokenDecimals + feedDecimals)` must stay inside uint256, and a component
            // whose decimals overflow it would brick every priced path with no way to recover.
            if (tokenDecimals > 36 || feedDecimals > 36) {
                revert UnsupportedDecimals(ci.token, tokenDecimals);
            }

            totalWeight += ci.targetWeightBps;
            components.push(
                Component({
                    token: ci.token,
                    feed: ci.feed,
                    targetWeightBps: ci.targetWeightBps,
                    tokenDecimals: tokenDecimals,
                    feedDecimals: feedDecimals,
                    pool: ci.pool
                })
            );
        }
        if (totalWeight != 10_000) revert InvalidTotalWeight();

        bytes memory params = B20FactoryLib.encodeAssetCreateParams(shareName, shareSymbol, address(this), 18);

        // MINT/BURN back the share supply on deposit/redeem; OPERATOR is required by `announce`;
        // METADATA is required by the `updateExtraMetadata` calls below. Transfer-side policies
        // are left unset (built-in always-allow) — shares stay freely composable.
        bytes[] memory initCalls = new bytes[](4);
        initCalls[0] = B20FactoryLib.encodeGrantRole(B20Constants.MINT_ROLE, address(this));
        initCalls[1] = B20FactoryLib.encodeGrantRole(B20Constants.BURN_ROLE, address(this));
        initCalls[2] = B20FactoryLib.encodeGrantRole(B20Constants.OPERATOR_ROLE, address(this));
        initCalls[3] = B20FactoryLib.encodeGrantRole(B20Constants.METADATA_ROLE, address(this));

        address share = StdPrecompiles.B20_FACTORY.createB20(IB20Factory.B20Variant.ASSET, salt, params, initCalls);
        SHARE = IB20Asset(share);

        SHARE.updateExtraMetadata("index_rule", indexRuleDescription);
        SHARE.updateExtraMetadata("rebalance_policy", "threshold-based, permissionless");
        SHARE.updateExtraMetadata("operator_powers", "pause deposits, adjust bounded params. Cannot move funds.");
    }

    /*//////////////////////////////////////////////////////////////
                                DEPOSITS
    //////////////////////////////////////////////////////////////*/

    /// @notice Deposit USDC, receive shares proportional to NAV. `sellAmounts[i]` is the USDC
    ///         routed into component `i` (0 to skip); `swapCalldata[i]` is the corresponding
    ///         0x AllowanceHolder calldata. Both arrays are built off-chain by the frontend and
    ///         aligned 1:1 with `components`. Any USDC not allocated to a swap stays as fund cash
    ///         (still counted in NAV) rather than being lost.
    function deposit(uint256 usdcAmount, uint256[] calldata sellAmounts, bytes[] calldata swapCalldata)
        external
        nonReentrant
    {
        if (depositsPaused) revert DepositsArePaused();
        if (sellAmounts.length != components.length || swapCalldata.length != components.length) {
            revert LengthMismatch();
        }

        uint256 allocated;
        for (uint256 i = 0; i < components.length; i++) {
            allocated += sellAmounts[i];
        }
        if (allocated > usdcAmount) revert AllocationExceedsDeposit();

        uint256 navBefore = totalNAV();
        uint256 supplyBefore = SHARE.totalSupply();

        // Supply can only reach zero through a full exit, which should leave nothing behind. If
        // value remains anyway — an abandoned component from `redeemInKindSkippingBlocked` — it
        // belongs to nobody, and this depositor would silently acquire all of it.
        if (supplyBefore == 0 && navBefore > 0) revert FundHasOrphanedAssets(navBefore);

        // Caps bound live exposure rather than lifetime flow, so exiting frees room to return and
        // a fully-redeemed fund is not permanently closed.
        if (_positionValue(msg.sender, navBefore, supplyBefore) + usdcAmount > maxPositionPerWallet) {
            revert ExceedsWalletCap();
        }
        if (navBefore + usdcAmount > maxFundValue) revert ExceedsFundCap();

        require(IB20(USDC).transferFrom(msg.sender, address(this), usdcAmount), "TRANSFER_FAILED");

        for (uint256 i = 0; i < components.length; i++) {
            if (sellAmounts[i] == 0) continue;
            _executeSwap(USDC, sellAmounts[i], swapCalldata[i], i, true);
        }

        uint256 navAfter = totalNAV();
        uint256 valueAdded = navAfter - navBefore;

        // `navBefore == 0` with live supply means the fund holds only dust that rounds away; there
        // is no meaningful ratio to mint against, so deposits wait rather than dividing by zero.
        if (supplyBefore > 0 && navBefore == 0) revert FundHasOrphanedAssets(0);

        uint256 sharesOut =
            supplyBefore == 0 ? valueAdded * 1e12 : (valueAdded * supplyBefore) / navBefore;
        if (sharesOut == 0) revert ZeroShares();

        SHARE.mint(msg.sender, sharesOut);
        depositedBy[msg.sender] += usdcAmount;
        totalDeposited += usdcAmount;

        emit Deposited(msg.sender, usdcAmount, sharesOut, (navAfter * 1e18) / SHARE.totalSupply());
    }

    /*//////////////////////////////////////////////////////////////
                               REDEMPTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Burn shares, receive USDC. Sells a pro-rata raw-balance claim of each component
    ///         (same split as `redeemInKind`) plus a pro-rata share of existing USDC cash.
    ///         `swapCalldata[i]` sells that claim into USDC; pass an empty entry to skip a
    ///         component with a zero claim.
    function redeem(uint256 shareAmount, bytes[] calldata swapCalldata) external nonReentrant {
        if (swapCalldata.length != components.length) revert LengthMismatch();
        uint256 supply = SHARE.totalSupply();
        if (shareAmount == 0 || supply == 0) revert ZeroShares();

        uint256 usdcOut = (IB20(USDC).balanceOf(address(this)) * shareAmount) / supply;

        _releaseDepositAllowance(msg.sender, shareAmount);
        require(SHARE.transferFrom(msg.sender, address(this), shareAmount), "TRANSFER_FAILED");
        SHARE.burn(shareAmount);

        for (uint256 i = 0; i < components.length; i++) {
            uint256 bal = IB20(components[i].token).balanceOf(address(this));
            uint256 claim = (bal * shareAmount) / supply;
            if (claim == 0) continue;
            usdcOut += _executeSwap(components[i].token, claim, swapCalldata[i], i, false);
        }
        if (usdcOut == 0) revert ZeroShares();

        require(IB20(USDC).transfer(msg.sender, usdcOut), "TRANSFER_FAILED");

        // Deliberately not re-pricing the fund here. The payout above is derived entirely from
        // balances, so calling totalNAV() only to fill an event field would let one stale feed —
        // on a component this redemption may not even have touched — revert an exit that had
        // already completed.
        emit Redeemed(msg.sender, shareAmount, usdcOut, supply - shareAmount);
    }

    /// @notice Emergency in-kind redemption. No swaps, no router, no oracle. Always available —
    ///         even when deposits are paused, the router is broken, or every feed is stale. This
    ///         is the guarantee that users can always exit.
    function redeemInKind(uint256 shareAmount) external nonReentrant {
        uint256 supply = SHARE.totalSupply();
        if (shareAmount == 0 || supply == 0) revert ZeroShares();

        // The fund's USDC is part of what a share represents — it is counted in NAV — so an
        // in-kind exit that returned only the components would hand the redeemer's cash to the
        // holders who stayed. A deposit that allocates nothing to swaps is explicitly allowed, and
        // such a holder's entire position is cash.
        uint256 cashClaim = (IB20(USDC).balanceOf(address(this)) * shareAmount) / supply;

        _releaseDepositAllowance(msg.sender, shareAmount);
        require(SHARE.transferFrom(msg.sender, address(this), shareAmount), "TRANSFER_FAILED");
        SHARE.burn(shareAmount);

        if (cashClaim > 0) require(IB20(USDC).transfer(msg.sender, cashClaim), "TRANSFER_FAILED");

        for (uint256 i = 0; i < components.length; i++) {
            IB20 token = IB20(components[i].token);
            uint256 bal = token.balanceOf(address(this));
            uint256 claim = (bal * shareAmount) / supply;
            if (claim > 0) require(token.transfer(msg.sender, claim), "TRANSFER_FAILED");
        }
        emit RedeemedInKind(msg.sender, shareAmount);
    }

    /// @notice Exit while abandoning any component that cannot currently be moved.
    ///
    ///         The components are policy-gated by their issuer, who can pause a token's transfers
    ///         or blocklist an address at any time. `redeemInKind` hands back every component or
    ///         none, so a single frozen component would otherwise trap every holder in the fund —
    ///         which would make the unconditional exit conditional on a third party.
    ///
    ///         This path transfers whatever it can and reports the rest. **The abandoned portion is
    ///         forfeited**: those shares are burned and the untransferable assets stay with the
    ///         remaining holders. Prefer `redeemInKind`; reach for this only when that one reverts.
    function redeemInKindSkippingBlocked(uint256 shareAmount) external nonReentrant {
        uint256 supply = SHARE.totalSupply();
        if (shareAmount == 0 || supply == 0) revert ZeroShares();

        uint256 cashClaim = (IB20(USDC).balanceOf(address(this)) * shareAmount) / supply;

        _releaseDepositAllowance(msg.sender, shareAmount);
        require(SHARE.transferFrom(msg.sender, address(this), shareAmount), "TRANSFER_FAILED");
        SHARE.burn(shareAmount);

        uint256 delivered;
        if (cashClaim > 0) {
            require(IB20(USDC).transfer(msg.sender, cashClaim), "TRANSFER_FAILED");
            delivered++;
        }

        uint256 n = components.length;
        address[] memory blocked = new address[](n);
        uint256 blockedCount;

        for (uint256 i = 0; i < n; i++) {
            IB20 token = IB20(components[i].token);
            uint256 bal = token.balanceOf(address(this));
            uint256 claim = (bal * shareAmount) / supply;
            if (claim == 0) continue;

            // A bare catch would also swallow out-of-gas, turning a transient gas shortfall into
            // the same permanent forfeiture as a real freeze. Under EIP-150 the callee gets at
            // most 63/64 of what remains, so refusing to attempt the call without a comfortable
            // margin keeps "blocked" meaning blocked.
            if (gasleft() < GAS_FLOOR_PER_TRANSFER) {
                revert InsufficientGasForTransfer(components[i].token);
            }

            // A component that reverts, or returns false, is recorded rather than allowed to
            // unwind the whole exit.
            try token.transfer(msg.sender, claim) returns (bool ok) {
                if (ok) delivered++;
                else blocked[blockedCount++] = components[i].token;
            } catch {
                blocked[blockedCount++] = components[i].token;
            }
        }

        // Burning a position in exchange for nothing must not be a successful transaction.
        if (delivered == 0) revert NothingDelivered();

        address[] memory reported = new address[](blockedCount);
        for (uint256 i = 0; i < blockedCount; i++) {
            reported[i] = blocked[i];
        }

        emit RedeemedInKindPartial(msg.sender, shareAmount, reported);
    }

    /*//////////////////////////////////////////////////////////////
                        REBALANCING (PERMISSIONLESS)
    //////////////////////////////////////////////////////////////*/

    /// @notice Rebalance toward target weights. Callable by anyone once the interval has elapsed
    ///         AND at least one component has drifted beyond threshold. `amounts[i] > 0` buys
    ///         component `i` with that much USDC; `amounts[i] < 0` sells `-amounts[i]` raw units
    ///         of component `i` for USDC; `0` means no trade. Every leg must move a component
    ///         toward (never past) its target, and every swap is validated against the oracle-
    ///         implied expected output. Caller receives `callerRewardBps` of post-trade NAV.
    function rebalance(int256[] calldata amounts, bytes[] calldata swapCalldata) external nonReentrant {
        if (block.timestamp < lastRebalanceAt + minRebalanceInterval) revert RebalanceTooSoon();
        if (amounts.length != components.length || swapCalldata.length != components.length) {
            revert LengthMismatch();
        }

        (bool needed, string memory reason) = _checkDrift();
        if (!needed) revert NoDriftDetected();

        uint256 navBefore = totalNAV();

        uint256 n = components.length;
        uint256[] memory preValue = new uint256[](n);
        uint256[] memory targetValue = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            preValue[i] = _componentValue(i);
            targetValue[i] = (navBefore * components[i].targetWeightBps) / 10_000;
        }

        // Sells first so buys can draw on the resulting USDC.
        uint256 tradedValue;
        for (uint256 i = 0; i < n; i++) {
            if (amounts[i] >= 0) continue;
            uint256 sellRaw = uint256(-amounts[i]);
            if (preValue[i] <= targetValue[i]) revert ComponentNotOverweight(i);
            uint256 sellValue = _quoteComponentToUsdc(components[i], sellRaw, _livePrice(components[i]));
            if (preValue[i] - sellValue < targetValue[i]) revert OverSell(i);
            tradedValue += sellValue;
            _executeSwap(components[i].token, sellRaw, swapCalldata[i], i, false);
        }
        for (uint256 i = 0; i < n; i++) {
            if (amounts[i] <= 0) continue;
            uint256 buyUsdc = uint256(amounts[i]);
            if (preValue[i] >= targetValue[i]) revert ComponentNotUnderweight(i);
            if (preValue[i] + buyUsdc > targetValue[i]) revert OverBuy(i);
            tradedValue += buyUsdc;
            _executeSwap(USDC, buyUsdc, swapCalldata[i], i, true);
        }

        uint256 maxDriftAfter = _maxDrift();
        if (maxDriftAfter > driftThresholdBps) revert DriftNotResolved(maxDriftAfter);

        uint256 navAfter = totalNAV();

        // Charged on the value actually moved, never on total NAV. A reward proportional to the
        // whole fund would pay a caller far more than the work performed, and drift is cheap to
        // manufacture — idle cash alone produces it — so that shape would hand a standing income
        // stream to anyone willing to churn the fund, the operator included. Capped by the cash on
        // hand so a rebalance that deploys its proceeds cannot revert for want of a reserve.
        uint256 reward = (tradedValue * callerRewardBps) / 10_000;
        uint256 cash = IB20(USDC).balanceOf(address(this));
        if (reward > cash) reward = cash;
        if (reward > 0) require(IB20(USDC).transfer(msg.sender, reward), "TRANSFER_FAILED");

        string memory id = string.concat("rebalance-", _toString(rebalanceCount));
        SHARE.announce(new bytes[](0), id, reason, "");

        lastRebalanceAt = uint64(block.timestamp);
        rebalanceCount++;

        emit Rebalanced(rebalanceCount - 1, msg.sender, reason, navBefore, navAfter, reward);
    }

    /// @notice Is a rebalance currently possible, and why?
    function rebalanceStatus()
        external
        view
        returns (bool possible, string memory reason, uint256 nextEligibleAt, uint256 maxDriftBps)
    {
        nextEligibleAt = lastRebalanceAt + minRebalanceInterval;
        maxDriftBps = _maxDrift();
        if (block.timestamp < nextEligibleAt) {
            return (false, "interval not elapsed", nextEligibleAt, maxDriftBps);
        }
        (possible, reason) = _checkDrift();
    }

    /*//////////////////////////////////////////////////////////////
                                   NAV
    //////////////////////////////////////////////////////////////*/

    /// @notice Total fund value in USDC terms (6 decimals), from Chainlink feeds. Reverts if any
    ///         feed is stale — you cannot price a fund against a frozen oracle. Chainlink feeds
    ///         return Total Return Values that already include the multiplier; balances used here
    ///         are raw (not scaled), so multiplying by TRV price scales exactly once.
    function totalNAV() public view returns (uint256 nav) {
        for (uint256 i = 0; i < components.length; i++) {
            nav += _componentValue(i);
        }
        nav += IB20(USDC).balanceOf(address(this));
    }

    /// @notice NAV per share in USDC terms (6 decimals). An empty fund reports the bootstrap price
    ///         of one USDC per share — in the same units as the live branch, not the 1e18 that
    ///         would render as a trillion dollars.
    function navPerShare() external view returns (uint256) {
        uint256 supply = SHARE.totalSupply();
        return supply == 0 ? 1e6 : (totalNAV() * 1e18) / supply;
    }

    function currentWeights() external view returns (uint16[] memory weights) {
        uint256 n = components.length;
        weights = new uint16[](n);
        uint256 nav = totalNAV();
        if (nav == 0) return weights;
        for (uint256 i = 0; i < n; i++) {
            // A component's value can never exceed total NAV, so this ratio is always <= 10_000.
            // forge-lint: disable-next-line(unsafe-typecast)
            weights[i] = uint16((_componentValue(i) * 10_000) / nav);
        }
    }

    /// @notice Underlying shares each component represents, applying its multiplier. This is what
    ///         holders actually own in real-world share terms — distinct from NAV, which is priced
    ///         off the TRV feed and must not apply the multiplier a second time.
    function scaledHoldings() external view returns (uint256[] memory out) {
        uint256 n = components.length;
        out = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = IB20Asset(components[i].token).scaledBalanceOf(address(this));
        }
    }

    /// @notice Are all feeds fresh enough to price the fund right now?
    function feedsHealthy() external view returns (bool healthy, address staleFeed) {
        uint256 n = components.length;
        for (uint256 i = 0; i < n; i++) {
            (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(components[i].feed).latestRoundData();
            // Mirrors every check `_livePrice` makes. Reporting healthy while a non-positive answer
            // makes each priced call revert would be worse than useless.
            if (answer <= 0 || block.timestamp - updatedAt > feedStalenessTolerance) {
                return (false, components[i].feed);
            }
        }
        return (true, address(0));
    }

    function componentsLength() external view returns (uint256) {
        return components.length;
    }

    /*//////////////////////////////////////////////////////////////
                  OPERATOR FUNCTIONS: BOUNDED, NEVER CUSTODIAL
    //////////////////////////////////////////////////////////////*/

    function setDepositsPaused(bool paused) external onlyOperator {
        depositsPaused = paused;
        emit DepositsPausedSet(paused);
    }

    function setDriftThreshold(uint16 bps) external onlyOperator {
        if (bps < 100 || bps > 2000) revert OutOfBounds();
        emit ParamsUpdated("driftThresholdBps", driftThresholdBps, bps);
        driftThresholdBps = bps;
    }

    function setMinRebalanceInterval(uint32 s) external onlyOperator {
        if (s < 1 days || s > 90 days) revert OutOfBounds();
        emit ParamsUpdated("minRebalanceInterval", minRebalanceInterval, s);
        minRebalanceInterval = s;
    }

    function setMaxSlippage(uint16 bps) external onlyOperator {
        // A floor as well as a ceiling: zero tolerance would demand an exact oracle match and brick
        // every priced path, which is a denial of service dressed up as prudence.
        if (bps < 10 || bps > 500) revert OutOfBounds();
        emit ParamsUpdated("maxSlippageBps", maxSlippageBps, bps);
        maxSlippageBps = bps;
    }

    /// @notice Bounded at 1% of traded value. The reward is charged on volume, not on NAV, so this
    ///         ceiling bounds what churning the fund can extract.
    function setCallerReward(uint16 bps) external onlyOperator {
        if (bps > 100) revert OutOfBounds();
        emit ParamsUpdated("callerRewardBps", callerRewardBps, bps);
        callerRewardBps = bps;
    }

    function setStalenessTolerance(uint32 s) external onlyOperator {
        if (s < 1 hours || s > 72 hours) revert OutOfBounds();
        emit ParamsUpdated("feedStalenessTolerance", feedStalenessTolerance, s);
        feedStalenessTolerance = s;
    }

    /// @notice Bounded well below the NAV tolerance: a swap is validated against this price, so
    ///         letting it age would reintroduce trading against a stale mark.
    function setSwapPriceMaxAge(uint32 s) external onlyOperator {
        if (s < 10 minutes || s > 6 hours) revert OutOfBounds();
        emit ParamsUpdated("swapPriceMaxAge", swapPriceMaxAge, s);
        swapPriceMaxAge = s;
    }

    /// @notice Flips the TWAP fallback described where `twapFallbackEnabled` is declared. Anyone
    ///         can read the current state; only the operator can change it.
    function setTwapFallbackEnabled(bool enabled) external onlyOperator {
        emit ParamsUpdated("twapFallbackEnabled", twapFallbackEnabled ? 1 : 0, enabled ? 1 : 0);
        twapFallbackEnabled = enabled;
    }

    function setTwapWindow(uint32 w) external onlyOperator {
        if (w < 10 minutes || w > 2 hours) revert OutOfBounds();
        emit ParamsUpdated("twapWindow", twapWindow, w);
        twapWindow = w;
    }

    /// @notice Caps are the only compensating control on an unaudited contract, so they are bounded
    ///         like every other parameter rather than settable to anything.
    function setCaps(uint256 perWallet, uint256 fundValue) external onlyOperator {
        if (perWallet == 0 || fundValue == 0) revert OutOfBounds();
        if (perWallet > fundValue) revert OutOfBounds();
        if (fundValue > MAX_FUND_VALUE_CEILING) revert OutOfBounds();
        emit ParamsUpdated("maxPositionPerWallet", maxPositionPerWallet, perWallet);
        emit ParamsUpdated("maxFundValue", maxFundValue, fundValue);
        maxPositionPerWallet = perWallet;
        maxFundValue = fundValue;
    }

    /*//////////////////////////////////////////////////////////////
                                 INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev Current value of `holder`'s stake, used to bound exposure on deposit. Measuring the
    ///      live position rather than a running total of past deposits is what makes the cap
    ///      unevadable: a holder cannot reset it by moving shares around, because the cap follows
    ///      the shares.
    function _positionValue(address holder, uint256 nav, uint256 supply) internal view returns (uint256) {
        if (supply == 0 || nav == 0) return 0;
        return (nav * SHARE.balanceOf(holder)) / supply;
    }

    /// @dev Reduces the holder's recorded cost basis in proportion to the position being redeemed.
    ///      This figure drives the displayed P&L only — it gates nothing, so an inexact result
    ///      cannot be used to exceed a cap.
    ///
    ///      Must be called before the shares are pulled in, while the holder still owns them.
    function _releaseDepositAllowance(address holder, uint256 shareAmount) internal {
        uint256 held = SHARE.balanceOf(holder);
        uint256 recorded = depositedBy[holder];
        if (held == 0 || recorded == 0) return;

        uint256 released = shareAmount >= held ? recorded : (recorded * shareAmount) / held;
        depositedBy[holder] = recorded - released;
        totalDeposited = released > totalDeposited ? 0 : totalDeposited - released;
    }

    /// @dev Reads the live TRV price for a component's feed, reverting `StaleFeed` per the
    ///      calibrated tolerance. Never trust a frozen oracle to price the fund.
    function _livePrice(Component memory c) internal view returns (uint256 answer) {
        return _priceWithMaxAge(c, feedStalenessTolerance);
    }

    /// @dev The reference price a swap is judged against, held to a much tighter age than NAV. A
    ///      weekend-old close is an acceptable basis for reporting what the fund is worth; it is
    ///      not an acceptable basis for deciding whether a trade was fair, because a caller can
    ///      trade against the difference.
    function _swapPrice(Component memory c) internal view returns (uint256) {
        return _priceWithMaxAge(c, swapPriceMaxAge);
    }

    function _priceWithMaxAge(Component memory c, uint256 maxAge) internal view returns (uint256 answer) {
        (, int256 a,, uint256 updatedAt,) = IAggregatorV3(c.feed).latestRoundData();
        bool fresh = a > 0 && block.timestamp - updatedAt <= maxAge;
        if (fresh) {
            // forge-lint: disable-next-line(unsafe-typecast)
            return uint256(a);
        }
        // Falls back only if the operator opted in and this component has a pool configured —
        // both conditions default closed, so an unconfigured deploy reverts exactly as it always
        // has. See where `twapFallbackEnabled` is declared for what this trades away.
        if (twapFallbackEnabled && c.pool != address(0)) {
            return TwapOracle.twapAnswer(c.pool, twapWindow, c.tokenDecimals, c.feedDecimals);
        }
        revert StaleFeed(c.feed, updatedAt);
    }

    function _componentValue(uint256 index) internal view returns (uint256) {
        Component memory c = components[index];
        uint256 answer = _livePrice(c);
        uint256 bal = IB20(c.token).balanceOf(address(this));
        return _quoteComponentToUsdc(c, bal, answer);
    }

    /// @dev USDC(6dp) amount -> expected raw component units at `answer`, generic over each
    ///      component's own cached decimals (all confirmed 8dp for the current basket, but this
    ///      does not hardcode that).
    function _quoteUsdcToComponent(Component memory c, uint256 usdcAmount, uint256 answer)
        internal
        pure
        returns (uint256)
    {
        return (usdcAmount * (10 ** (uint256(c.feedDecimals) + uint256(c.tokenDecimals)))) / (1e6 * answer);
    }

    /// @dev Raw component units -> expected USDC(6dp) at `answer`.
    function _quoteComponentToUsdc(Component memory c, uint256 rawAmount, uint256 answer)
        internal
        pure
        returns (uint256)
    {
        return (rawAmount * answer * 1e6) / (10 ** (uint256(c.tokenDecimals) + uint256(c.feedDecimals)));
    }

    /// @dev Executes one leg against `SWAP_ROUTER` and validates the outcome against the
    ///      oracle-implied expected output within `maxSlippageBps`. This — not the calldata
    ///      itself — is the security boundary: the calldata is untrusted, the priced outcome is
    ///      checked. `buying == true` means `tokenIn` is USDC and the component is being bought;
    ///      `false` means `tokenIn` is the component and USDC is being bought.
    function _executeSwap(
        address tokenIn,
        uint256 amountIn,
        bytes calldata swapCalldata,
        uint256 componentIndex,
        bool buying
    ) internal returns (uint256 actualOut) {
        if (amountIn == 0) return 0;
        if (swapCalldata.length < 4) revert SwapCalldataInvalid(componentIndex);

        Component memory c = components[componentIndex];
        address tokenOut = buying ? c.token : USDC;

        IB20(tokenIn).approve(SWAP_ROUTER, amountIn);
        uint256 outBefore = IB20(tokenOut).balanceOf(address(this));
        (bool ok,) = SWAP_ROUTER.call(swapCalldata);
        if (!ok) revert SwapFailed(componentIndex);
        uint256 outAfter = IB20(tokenOut).balanceOf(address(this));
        actualOut = outAfter - outBefore;
        IB20(tokenIn).approve(SWAP_ROUTER, 0);

        // Judged against a deliberately fresher price than NAV uses.
        uint256 answer = _swapPrice(c);
        uint256 expectedOut =
            buying ? _quoteUsdcToComponent(c, amountIn, answer) : _quoteComponentToUsdc(c, amountIn, answer);
        uint256 minOut = (expectedOut * (10_000 - maxSlippageBps)) / 10_000;
        if (actualOut < minOut) revert SlippageExceeded(buying ? c.token : USDC, expectedOut, actualOut);
    }

    function _checkDrift() internal view returns (bool needed, string memory reason) {
        uint256 nav = totalNAV();
        uint256 n = components.length;
        uint256 worstIdx;
        uint256 worstDriftBps;
        uint256 worstCurrentBps;
        bool worstOver;

        for (uint256 i = 0; i < n; i++) {
            uint256 value = _componentValue(i);
            uint256 currentBps = nav == 0 ? 0 : (value * 10_000) / nav;
            uint256 targetBps = components[i].targetWeightBps;
            uint256 driftBps = currentBps > targetBps ? currentBps - targetBps : targetBps - currentBps;
            if (driftBps > worstDriftBps) {
                worstDriftBps = driftBps;
                worstIdx = i;
                worstCurrentBps = currentBps;
                worstOver = currentBps > targetBps;
            }
        }

        if (worstDriftBps <= driftThresholdBps) return (false, "");

        reason = string.concat(
            IB20(components[worstIdx].token).symbol(),
            worstOver ? " drifted to " : " drifted down to ",
            _bpsToPercentString(worstCurrentBps),
            " (target ",
            _bpsToPercentString(components[worstIdx].targetWeightBps),
            "). Rebalancing to restore target weights."
        );
        needed = true;
    }

    function _maxDrift() internal view returns (uint256 maxDriftBps) {
        uint256 nav = totalNAV();
        uint256 n = components.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 value = _componentValue(i);
            uint256 currentBps = nav == 0 ? 0 : (value * 10_000) / nav;
            uint256 targetBps = components[i].targetWeightBps;
            uint256 d = currentBps > targetBps ? currentBps - targetBps : targetBps - currentBps;
            if (d > maxDriftBps) maxDriftBps = d;
        }
    }

    function _bpsToPercentString(uint256 bps) internal pure returns (string memory) {
        uint256 whole = bps / 100;
        uint256 frac = bps % 100;
        string memory fracStr = frac < 10 ? string.concat("0", _toString(frac)) : _toString(frac);
        return string.concat(_toString(whole), ".", fracStr, "%");
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 digits;
        uint256 temp = v;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (v != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(buffer);
    }
}
