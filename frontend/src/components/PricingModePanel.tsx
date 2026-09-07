"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { slateFundAbi } from "@/lib/abis";

/// Chainlink is the default and only source of truth for pricing unless the operator opts into
/// this fallback — see the "How it works" modal for the full tradeoff. This panel makes the
/// currently active mode visible to every visitor, and gives the operator a real transaction to
/// flip it, rather than a setting hidden in a script somewhere.
export function PricingModePanel({ fund, operator }: { fund: Address; operator?: Address }) {
  const { address: user } = useAccount();
  const isOperator = Boolean(user && operator && user.toLowerCase() === operator.toLowerCase());

  // A fund deployed before this feature existed simply doesn't have this function — the call
  // errors, `data` never resolves, and there's nothing to retry into success. That's the same
  // fact as "no fallback configured," so treat a failed read as `false` rather than leaving the
  // panel showing "…" forever, and skip trying to render an operator control for it either.
  const {
    data: enabled,
    isError: enabledUnsupported,
    refetch,
  } = useReadContract({
    address: fund,
    abi: slateFundAbi,
    functionName: "twapFallbackEnabled",
  });
  const { data: window_ } = useReadContract({
    address: fund,
    abi: slateFundAbi,
    functionName: "twapWindow",
    query: { enabled: !enabledUnsupported },
  });
  const resolvedEnabled = enabledUnsupported ? false : enabled;

  const [submitted, setSubmitted] = useState<`0x${string}` | undefined>();
  const { writeContractAsync, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: submitted,
    query: { enabled: Boolean(submitted) },
  });

  async function toggle() {
    const hash = await writeContractAsync({
      address: fund,
      abi: slateFundAbi,
      functionName: "setTwapFallbackEnabled",
      args: [!resolvedEnabled],
    });
    setSubmitted(hash);
    await refetch();
  }

  const windowMinutes = window_ !== undefined ? Number(window_) / 60 : undefined;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-medium text-white">Pricing mode</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            resolvedEnabled ? "bg-amber-500/10 text-amber-300" : "bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {resolvedEnabled === undefined
            ? "…"
            : resolvedEnabled
              ? "Chainlink + TWAP fallback"
              : "Chainlink only"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-neutral-400">
        {resolvedEnabled
          ? `When Chainlink is stale, this fund falls back to a ${
              windowMinutes ?? "…"
            }-minute time-weighted average price read directly from the Aerodrome pool, instead of
              blocking deposits, redemptions and rebalances. A real average is far harder to move
              than a spot price, but it is a weaker guarantee than a live independent oracle — see
              "How it works" above for the tradeoff.`
          : "Deposits, redemptions and rebalances only proceed on a live Chainlink price. If a feed goes stale — a long weekend, a holiday — pricing pauses rather than falling back to anything weaker."}
      </p>

      {isOperator && !enabledUnsupported && (
        <button
          type="button"
          onClick={toggle}
          disabled={isPending || isConfirming || resolvedEnabled === undefined}
          className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending || isConfirming
            ? "Confirming…"
            : resolvedEnabled
              ? "Disable TWAP fallback"
              : "Enable TWAP fallback"}
        </button>
      )}
    </div>
  );
}
