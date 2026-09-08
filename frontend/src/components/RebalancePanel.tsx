"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { slateFundAbi } from "@/lib/abis";
import { formatUsd, formatBps, formatTimestamp } from "@/lib/format";
import { useNowSeconds } from "@/lib/useNow";
import { useFeedHealth, type Component } from "@/lib/useFund";
import { fetchRebalanceLegs, type RebalanceLeg } from "@/lib/zeroex";

/// Under-correct every leg by this much so rounding, or the price ticking between quoting and
/// execution, can't push a leg past the contract's OverSell/OverBuy boundary (which checks against
/// the exact target, not a range). The contract only requires the *worst* drift to land back under
/// `driftThresholdBps` afterward, not that every component lands exactly on target, so leaving this
/// much on the table is free correctness margin, not a real cost.
const MARGIN_BPS = 50n; // 0.5%

/// Raw component units -> USDC(6dp), mirroring `SlateFund._quoteComponentToUsdc` exactly.
function quoteComponentToUsdc(
  raw: bigint,
  price: bigint,
  tokenDecimals: number,
  feedDecimals: number
): bigint {
  return (raw * price * 1_000_000n) / 10n ** BigInt(tokenDecimals + feedDecimals);
}

/// USDC(6dp) -> raw component units, mirroring `SlateFund._quoteUsdcToComponent` exactly.
function quoteUsdcToComponent(
  usdc: bigint,
  price: bigint,
  tokenDecimals: number,
  feedDecimals: number
): bigint {
  return (usdc * 10n ** BigInt(tokenDecimals + feedDecimals)) / (1_000_000n * price);
}

/// Rebalancing is permissionless, but the swap legs have to be built off-chain (the contract
/// validates their outcome against Chainlink rather than trusting the calldata). This panel
/// computes the legs that would restore target weights from the fund's own live state — component
/// balances, live prices, and total NAV — and hands the contract real calldata to try. The
/// contract rejects anything that would not actually restore the weights, so a wrong computation
/// here costs gas on a revert, never fund safety.
export function RebalancePanel({
  fund,
  possible,
  reason,
  nextEligibleAt,
  maxDriftBps,
  driftThresholdBps,
  callerRewardBps,
  totalNAV,
  navUnavailable,
  components,
}: {
  fund: Address;
  possible?: boolean;
  reason?: string;
  nextEligibleAt?: bigint;
  maxDriftBps?: bigint;
  driftThresholdBps?: number;
  callerRewardBps?: number;
  totalNAV?: bigint;
  navUnavailable?: boolean;
  components: Component[];
}) {
  const { isConnected } = useAccount();
  const now = useNowSeconds();
  const [submitted, setSubmitted] = useState<`0x${string}` | undefined>();
  const [legError, setLegError] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const { writeContractAsync, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: submitted,
  });

  const { data: swapPriceMaxAge } = useReadContract({
    address: fund,
    abi: slateFundAbi,
    functionName: "swapPriceMaxAge",
  });
  const { data: twapFallbackEnabled } = useReadContract({
    address: fund,
    abi: slateFundAbi,
    functionName: "twapFallbackEnabled",
  });

  // Rebalance legs are judged against swapPriceMaxAge (1h by default), much tighter than the
  // feedStalenessTolerance (72h) `totalNAV()`/`pricingUnavailable` above tolerate — see the same
  // note on the invest page. `isStale` here reflects that tighter bound, not the NAV one. Fail
  // safe while swapPriceMaxAge hasn't loaded yet, rather than falling back to useFeedHealth's
  // lenient default tolerance — the same gap that let a deposit through on a feed already past
  // the real bound. Once the operator has enabled the TWAP fallback, though, a stale Chainlink
  // feed no longer means the leg will revert — every component this factory deploys has a pool
  // configured, so treat "fallback enabled" as "covered" rather than blocking on Chainlink alone.
  const feeds = useFeedHealth(components, swapPriceMaxAge as bigint | undefined);
  const swapPricingStale =
    !twapFallbackEnabled && (swapPriceMaxAge === undefined || feeds.some((f) => f.isStale));

  const reward =
    totalNAV !== undefined && callerRewardBps !== undefined
      ? (totalNAV * BigInt(callerRewardBps)) / 10_000n
      : undefined;

  const eligibleNow =
    nextEligibleAt !== undefined && now > 0 ? BigInt(now) >= nextEligibleAt : undefined;

  // totalNAV() reverts outright while any feed is stale (checked unconditionally for every
  // component, even ones the fund holds none of) — distinct from a fund that priced fine and is
  // genuinely empty. Either way, no legs can be computed: `pricingUnavailable` means there's no
  // live price to compute them from; a truly empty fund can't produce any (the contract's own
  // drift check reports "needed" even at zero NAV — 0% is "drifted" from any positive target — but
  // every leg would then revert, since current and target value are both zero for every component).
  const pricingUnavailable = navUnavailable === true;
  const fundIsEmpty = totalNAV === 0n;
  const cannotRebalance =
    pricingUnavailable || fundIsEmpty || totalNAV === undefined || swapPricingStale;
  const canAttempt = possible && !cannotRebalance;

  function computeLegs(): RebalanceLeg[] | null {
    if (cannotRebalance || totalNAV === undefined) return null;

    const legs: RebalanceLeg[] = [];
    for (const f of feeds) {
      if (f.price === undefined || f.balance === undefined) return null;

      const currentValue = quoteComponentToUsdc(f.balance, f.price, f.tokenDecimals, f.feedDecimals);
      const targetValue = (totalNAV * BigInt(f.targetWeightBps)) / 10_000n;

      if (currentValue > targetValue) {
        const sellValue = ((currentValue - targetValue) * (10_000n - MARGIN_BPS)) / 10_000n;
        const sellRaw = quoteUsdcToComponent(sellValue, f.price, f.tokenDecimals, f.feedDecimals);
        legs.push({ token: f.token, signedAmount: -sellRaw });
      } else if (currentValue < targetValue) {
        const buyValue = ((targetValue - currentValue) * (10_000n - MARGIN_BPS)) / 10_000n;
        legs.push({ token: f.token, signedAmount: buyValue });
      } else {
        legs.push({ token: f.token, signedAmount: 0n });
      }
    }
    return legs;
  }

  async function trigger() {
    setLegError(null);
    const legs = computeLegs();
    if (!legs) {
      setLegError(
        pricingUnavailable
          ? "Pricing is paused while a feed is stale, so legs can't be safely computed. Try again once it updates."
          : swapPricingStale
            ? "NAV is priced fine, but at least one feed is too old to validate a swap against right now. Try again once feeds update."
            : fundIsEmpty
              ? "This fund holds nothing yet, so there is nothing to rebalance. Wait for a deposit."
              : "Feed prices aren't loaded yet — try again in a moment."
      );
      return;
    }

    setIsBuilding(true);
    try {
      const { amounts, calldata } = await fetchRebalanceLegs({ fund, legs });
      const hash = await writeContractAsync({
        address: fund,
        abi: slateFundAbi,
        functionName: "rebalance",
        args: [amounts, calldata],
      });
      setSubmitted(hash);
    } catch (e) {
      setLegError(e instanceof Error ? e.message : "Could not build the rebalance legs.");
    } finally {
      setIsBuilding(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-medium text-white">Rebalance status</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            canAttempt
              ? "bg-emerald-500/10 text-emerald-300"
              : pricingUnavailable || swapPricingStale
                ? "bg-amber-500/10 text-amber-300"
                : "bg-red-500/10 text-red-300"
          }`}
        >
          {canAttempt
            ? "Rebalanceable now"
            : pricingUnavailable
              ? "Pricing paused"
              : swapPricingStale
                ? "Swap pricing stale"
                : fundIsEmpty
                  ? "Fund is empty"
                  : "Not needed"}
        </span>
      </div>

      {reason && possible && (
        <p className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-neutral-300">
          {pricingUnavailable
            ? "A component's feed is stale, so NAV can't be computed right now — nothing to rebalance against."
            : swapPricingStale
              ? "NAV is priced fine, but at least one feed is too old to validate a swap against right now."
              : fundIsEmpty
                ? "No deposits yet — nothing to rebalance."
                : reason}
        </p>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs text-neutral-500">Max drift</dt>
          <dd className="mt-1 text-neutral-200">{formatBps(maxDriftBps)}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Threshold</dt>
          <dd className="mt-1 text-neutral-200">{formatBps(driftThresholdBps)}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Next eligible</dt>
          <dd className="mt-1 text-neutral-200">
            {eligibleNow ? "Now" : formatTimestamp(nextEligibleAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Caller reward</dt>
          <dd className="mt-1 text-neutral-200">
            {formatUsd(reward)}{" "}
            <span className="text-xs text-neutral-500">({formatBps(callerRewardBps)})</span>
          </dd>
        </div>
      </dl>

      <button
        type="button"
        disabled={!isConnected || !canAttempt || isPending || isConfirming || isBuilding}
        onClick={trigger}
        className="mt-6 w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-neutral-500"
      >
        {!isConnected
          ? "Connect a wallet to trigger"
          : isBuilding
            ? "Building legs…"
            : isPending || isConfirming
              ? "Confirming…"
              : "Trigger rebalance"}
      </button>

      {legError && <p className="mt-3 text-xs text-amber-400">{legError}</p>}

      {isSuccess && (
        <p className="mt-3 text-xs text-emerald-400">
          Rebalance confirmed. The reason is now permanently onchain.
        </p>
      )}
      {error && (
        <p className="mt-3 text-xs text-amber-400">
          {error.message.includes("NoDriftDetected")
            ? "The fund is already within its target weights."
            : error.message.includes("RebalanceTooSoon")
              ? "The minimum interval since the last rebalance has not elapsed."
              : "This rebalance was rejected. Swap legs must actually restore the target weights and clear the slippage check."}
        </p>
      )}

      <p className="mt-4 text-xs leading-relaxed text-neutral-600">
        Anyone can call this — there is no keeper and no privileged address. Swap legs are built
        off-chain and validated onchain against Chainlink, so a rebalance that would move the fund
        away from its targets, or execute at a bad price, reverts.
      </p>
    </div>
  );
}
