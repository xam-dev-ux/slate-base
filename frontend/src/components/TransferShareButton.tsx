"use client";

import { useState, type MouseEvent, type SyntheticEvent } from "react";
import { isAddress, type Address } from "viem";
import { useWaitForTransactionReceipt } from "wagmi";
import { useAttributedWriteContract } from "@/lib/useAttributedWrite";
import { erc20Abi } from "@/lib/abis";
import { formatShares } from "@/lib/format";

/// Your position is a plain, transferable B20 token — this is the one place that says so and lets
/// you act on it, instead of only ever exiting through the app's own redeem flow.
export function TransferShareButton({
  share,
  balance,
}: {
  share: Address;
  balance: bigint;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [hash, setHash] = useState<`0x${string}` | undefined>();

  const { writeContractAsync, isPending, error } = useAttributedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const validRecipient = isAddress(to);

  // Stops the click from also firing whatever this button is nested inside (the portfolio row is
  // a clickable card) — same guard AddToWalletButton uses.
  function stop(e: SyntheticEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function transfer(e: MouseEvent) {
    stop(e);
    if (!validRecipient) return;
    const h = await writeContractAsync({
      address: share,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as Address, balance],
    });
    setHash(h);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          setOpen(true);
        }}
        className="font-mono text-xs text-neutral-500 underline decoration-dotted transition hover:text-neutral-300"
      >
        Transfer
      </button>
    );
  }

  return (
    <div onClick={stop} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Recipient address (0x…)"
        className="w-56 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-xs text-neutral-200 outline-none focus:border-white/30"
      />
      <button
        type="button"
        onClick={transfer}
        disabled={!validRecipient || isPending || isConfirming}
        className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-neutral-500"
      >
        {isPending || isConfirming ? "Confirming…" : `Send all ${formatShares(balance)}`}
      </button>
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          setOpen(false);
        }}
        className="text-xs text-neutral-600 transition hover:text-neutral-400"
      >
        Cancel
      </button>
      {error && (
        <p className="w-full text-xs text-amber-400">
          {error.message.split("\n")[0]}
        </p>
      )}
      {isSuccess && <p className="w-full text-xs text-emerald-400">Sent.</p>}
    </div>
  );
}
