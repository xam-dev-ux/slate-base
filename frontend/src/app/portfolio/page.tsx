"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useFundList, useFundSummary, useShareInfo } from "@/lib/useFund";
import { erc20Abi, slateFundAbi } from "@/lib/abis";
import { formatUsd, formatShares } from "@/lib/format";
import {
  FundTimelineRows,
  TimelineList,
  type TimelineEntry,
} from "@/components/PersonalTimeline";
import { AddToWalletButton } from "@/components/AddToWalletButton";

function PositionRow({ fund, user }: { fund: Address; user: Address }) {
  const summary = useFundSummary(fund);
  const share = useShareInfo(summary.share);

  const {
    data: shares,
    isLoading: sharesLoading,
    isError: sharesError,
    refetch: refetchShares,
  } = useReadContract({
    address: summary.share,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [user],
    query: { enabled: Boolean(summary.share) },
  });

  const { data: deposited } = useReadContract({
    address: fund,
    abi: slateFundAbi,
    functionName: "depositedBy",
    args: [user],
  });

  const balance = shares as bigint | undefined;

  // A failed or still-in-flight read looks identical to "you hold nothing" here unless kept
  // apart explicitly — on a page whose whole job is telling someone whether they have a position,
  // silently rendering nothing on an RPC hiccup reads as "you have no position", not as "we
  // couldn't check". Only a resolved, genuine zero balance hides the row.
  if (summary.share && (sharesLoading || sharesError)) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm text-neutral-500">
        <span>{sharesError ? "Couldn't check your position." : "Checking your position…"}</span>
        {sharesError && (
          <button
            type="button"
            onClick={() => refetchShares()}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-white/30 hover:text-white"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!balance || balance === 0n) return null;

  const fraction =
    share.totalSupply && share.totalSupply > 0n ? Number(balance) / Number(share.totalSupply) : 0;
  const value =
    summary.totalNAV !== undefined
      ? BigInt(Math.floor(Number(summary.totalNAV) * fraction))
      : undefined;

  const cost = deposited as bigint | undefined;
  const pnl = value !== undefined && cost !== undefined ? value - cost : undefined;

  return (
    <Link
      href={`/funds/${fund}`}
      className="flex flex-wrap items-center gap-6 rounded-xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/20"
    >
      <div className="min-w-[180px]">
        <p className="font-medium text-white">{share.name ?? "…"}</p>
        <p className="mt-0.5 font-mono text-xs text-neutral-500">{share.symbol}</p>
        {summary.share && <AddToWalletButton address={summary.share} symbol={share.symbol} />}
      </div>

      <div>
        <p className="text-xs text-neutral-500">Shares</p>
        <p className="mt-1 text-sm text-neutral-200">{formatShares(balance)}</p>
      </div>

      <div>
        <p className="text-xs text-neutral-500">Value</p>
        <p className="mt-1 text-sm text-neutral-200">
          {summary.navUnavailable ? "Oracles behind" : formatUsd(value)}
        </p>
      </div>

      <div>
        <p className="text-xs text-neutral-500">Deposited</p>
        <p className="mt-1 text-sm text-neutral-200">{formatUsd(cost)}</p>
      </div>

      <div>
        <p className="text-xs text-neutral-500">P&amp;L</p>
        <p
          className={`mt-1 text-sm ${
            pnl === undefined ? "text-neutral-500" : pnl >= 0n ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {pnl === undefined
            ? "—"
            : `${pnl >= 0n ? "+" : "-"}${formatUsd(pnl >= 0n ? pnl : -pnl)}`}
        </p>
      </div>
    </Link>
  );
}

export default function PortfolioPage() {
  const { address: user, isConnected } = useAccount();
  const { funds } = useFundList();

  // Each fund reports its own timeline rows; merging them here gives one chronological view.
  const [rowsByFund, setRowsByFund] = useState<Record<string, TimelineEntry[]>>({});
  const collect = useCallback((fund: Address, rows: TimelineEntry[]) => {
    setRowsByFund((prev) => ({ ...prev, [fund]: rows }));
  }, []);

  const timeline = Object.values(rowsByFund)
    .flat()
    .sort((a, b) => Number(b.blockNumber - a.blockNumber));

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-white">Portfolio</h1>

      {!isConnected || !user ? (
        <div className="mt-8 rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
          <p className="text-sm text-neutral-400">
            Connect a wallet to see your positions across every Slate fund.
          </p>
          <div className="mt-5 flex justify-center">
            <ConnectButton />
          </div>
        </div>
      ) : funds.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">No funds deployed yet.</p>
      ) : (
        <div className="mt-8 space-y-3">
          {funds.map((fund) => (
            <PositionRow key={fund} fund={fund} user={user} />
          ))}
        </div>
      )}

      {isConnected && user && funds.length > 0 && (
        <section className="mt-14">
          {funds.map((fund) => (
            <FundTimelineRows key={fund} fund={fund} user={user} onRows={collect} />
          ))}

          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
            What happened while you held
          </h2>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-neutral-600">
            Every rebalance that took place while you held shares, across all funds, with the share
            of its cost that was actually yours. Stakes are replayed from the share tokens&apos;
            transfer logs, so a rebalance from before you deposited is not billed to you.
          </p>
          <div className="mt-4">
            <TimelineList entries={timeline} />
          </div>
        </section>
      )}

      <p className="mt-10 text-xs leading-relaxed text-neutral-600">
        P&amp;L compares your position&apos;s current NAV share against the USDC you deposited, and
        does not subtract the rebalance costs itemised above.
      </p>
    </div>
  );
}
