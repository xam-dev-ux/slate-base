"use client";

import type { Address } from "viem";
import { useWatchAsset } from "wagmi";

/// One click to get the share token listed in the connected wallet (EIP-747 `wallet_watchAsset`),
/// instead of asking a holder to paste the contract address in by hand.
export function AddToWalletButton({
  address,
  symbol,
}: {
  address: Address;
  symbol?: string;
}) {
  const { watchAsset, isPending } = useWatchAsset();

  return (
    <button
      type="button"
      onClick={(e) => {
        // Guards against being nested inside a clickable row/link (e.g. the portfolio list) —
        // without this, the click would also trigger whatever wraps the button.
        e.preventDefault();
        e.stopPropagation();
        watchAsset({
          type: "ERC20",
          options: { address, symbol: symbol ?? "SHARE", decimals: 18 },
        });
      }}
      disabled={isPending}
      className="font-mono text-xs text-neutral-500 underline decoration-dotted transition hover:text-neutral-300 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isPending ? "Adding…" : `+ Add ${symbol ?? "token"} to wallet`}
    </button>
  );
}
