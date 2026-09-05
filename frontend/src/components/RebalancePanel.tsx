"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { slateFundAbi } from "@/lib/abis";
import { formatUsd, formatBps, formatTimestamp } from "@/lib/format";
import { useNowSeconds } from "@/lib/useNow";

/// Rebalancing is permissionless, but the swap legs have to be built off-chain (the contract
/// validates their outcome against Chainlink rather than trusting the calldata). Constructing
/// those legs needs a 0x quote, so this panel surfaces the live status and hands a
/// zero-leg transaction to anyone who wants to try — the contract rejects anything that would
/// not actually restore the weights.
export function RebalancePanel({
  fund,
  possible,
  reason,
  nextEligibleAt,
  maxDriftBps,
  driftThresholdBps,
  callerRewardBps,
  totalNAV,
}: {
  fund: Address;
  possible?: boolean;
  reason?: string;
  nextEligibleAt?: bigint;
  maxDriftBps?: bigint;
  driftThresholdBps?: number;
  callerRewardBps?: number;
  totalNAV?: bigint;
}) {
  const { isConnected } = useAccount();
  const now = useNowSeconds();
  const [submitted, setSubmitted] = useState<`0x${string}` | undefined>();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: submitted,
  });

  const reward =
    totalNAV !== undefined && callerRewardBps !== undefined
      ? (totalNAV * BigInt(callerRewardBps)) / 10_000n
      : undefined;

  const eligibleNow =
    nextEligibleAt !== undefined && now > 0 ? BigInt(now) >= nextEligibleAt : undefined;

  async function trigger() {
    const hash = await writeContractAsync({
      address: fund,
      abi: slateFundAbi,
      functionName: "rebalance",
      args: [[], []],
    });
    setSubmitted(hash);
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-medium text-white">Rebalance status</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            possible
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-white/5 text-neutral-400"
          }`}
        >
          {possible ? "Rebalanceable now" : "Not needed"}
        </span>
      </div>

      {reason && possible && (
        <p className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-neutral-300">
          {reason}
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
        disabled={!isConnected || !possible || isPending || isConfirming}
        onClick={trigger}
        className="mt-6 w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-neutral-500"
      >
        {!isConnected
          ? "Connect a wallet to trigger"
          : isPending || isConfirming
            ? "Confirming…"
            : "Trigger rebalance"}
      </button>

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
