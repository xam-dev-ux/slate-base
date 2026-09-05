"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { erc20Abi, slateFundAbi } from "@/lib/abis";
import { formatShares } from "@/lib/format";

/// The unconditional exit. Deliberately available even when deposits are paused and every oracle
/// is frozen, because it touches neither the router nor a feed — it just hands back a pro-rata
/// slice of the underlying tokens.
export function RedeemInKindButton({
  fund,
  share,
  shares,
}: {
  fund: Address;
  share: Address;
  shares: bigint;
}) {
  const { address: user } = useAccount();
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const { writeContractAsync, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: share,
    abi: erc20Abi,
    functionName: "allowance",
    args: user ? [user, fund] : undefined,
    query: { enabled: Boolean(user) },
  });

  const needsApproval = (allowance as bigint | undefined) === undefined || (allowance as bigint) < shares;

  async function approve() {
    const h = await writeContractAsync({
      address: share,
      abi: erc20Abi,
      functionName: "approve",
      args: [fund, shares],
    });
    setHash(h);
    await refetchAllowance();
  }

  async function redeem() {
    const h = await writeContractAsync({
      address: fund,
      abi: slateFundAbi,
      functionName: "redeemInKind",
      args: [shares],
    });
    setHash(h);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:border-white/30 hover:text-white"
      >
        Redeem in kind
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <h3 className="text-sm font-medium text-white">Redeem in kind</h3>
      <p className="mt-2 text-xs leading-relaxed text-neutral-400">
        Burns {formatShares(shares)} shares and returns your proportional slice of each underlying
        token directly. No swaps, no router, no oracle — this works even when markets are closed.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        {needsApproval ? (
          <button
            type="button"
            onClick={approve}
            disabled={isPending || isConfirming}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:bg-white/5 disabled:text-neutral-500"
          >
            {isPending || isConfirming ? "Confirming…" : "Approve shares"}
          </button>
        ) : (
          <button
            type="button"
            onClick={redeem}
            disabled={isPending || isConfirming}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:bg-white/5 disabled:text-neutral-500"
          >
            {isPending || isConfirming ? "Confirming…" : "Redeem all shares"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-300 transition hover:border-white/30"
        >
          Cancel
        </button>
      </div>

      {isSuccess && (
        <p className="mt-3 text-xs text-emerald-400">
          Redeemed. The underlying tokens are in your wallet.
        </p>
      )}
    </div>
  );
}
