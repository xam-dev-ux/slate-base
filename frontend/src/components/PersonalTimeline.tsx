"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { useFundSummary, useShareInfo, useRebalanceHistory, useShareHistory } from "@/lib/useFund";
import { fractionAt } from "@/lib/shareHistory";
import { explorerTx } from "@/lib/config";

export type TimelineEntry = {
  fund: Address;
  fundName?: string;
  rebalanceId: bigint;
  reason: string;
  blockNumber: bigint;
  txHash: `0x${string}`;
  fraction: number;
  attributedCost: number;
};

/// Collects the rebalances of one fund that happened while this holder actually held shares, and
/// hands them to the parent. It renders nothing: hooks cannot be called in a loop, so each fund
/// needs its own component instance, and the parent merges the results into one timeline.
export function FundTimelineRows({
  fund,
  user,
  onRows,
}: {
  fund: Address;
  user: Address;
  onRows: (fund: Address, rows: TimelineEntry[]) => void;
}) {
  const summary = useFundSummary(fund);
  const info = useShareInfo(summary.share);
  const { data: records } = useRebalanceHistory(fund, summary.share);
  const { data: checkpoints } = useShareHistory(summary.share, user);

  const rows: TimelineEntry[] = [];
  if (records && checkpoints) {
    for (const r of records) {
      const fraction = fractionAt(checkpoints, r.blockNumber, r.logIndex);
      if (fraction <= 0) continue; // not holding then, so it never touched them
      const cost = r.navBefore > r.navAfter ? r.navBefore - r.navAfter : 0n;
      rows.push({
        fund,
        fundName: info.name,
        rebalanceId: r.rebalanceId,
        reason: r.reason,
        blockNumber: r.blockNumber,
        txHash: r.txHash,
        fraction,
        attributedCost: (Number(cost) / 1e6) * fraction,
      });
    }
  }

  // `rows` is rebuilt every render, so this signature stands in for it as a dependency and the
  // effect fires only on real changes.
  const signature = rows.map((r) => `${r.txHash}:${r.fraction}`).join("|");

  useEffect(() => {
    onRows(fund, rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fund, signature, onRows]);

  return null;
}

export function TimelineList({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
        <p className="text-sm text-neutral-400">Nothing has happened to your positions yet.</p>
        <p className="mt-2 text-xs leading-relaxed text-neutral-600">
          Rebalances that occur while you hold shares appear here, each with the share of the cost
          that was genuinely yours at that moment — not a figure derived from what you hold today.
        </p>
      </div>
    );
  }

  const total = entries.reduce((sum, e) => sum + e.attributedCost, 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        {entries.length} rebalance{entries.length === 1 ? "" : "s"} while holding · your share of
        the cost so far <span className="text-neutral-300">${total.toFixed(4)}</span>
      </p>

      {entries.map((e) => (
        <article
          key={`${e.txHash}-${String(e.rebalanceId)}`}
          className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
        >
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <Link
              href={`/funds/${e.fund}`}
              className="font-medium text-white transition hover:text-indigo-300"
            >
              {e.fundName ?? "Fund"}
            </Link>
            <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 font-mono text-indigo-300">
              #{String(e.rebalanceId)}
            </span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
              you held {(e.fraction * 100).toFixed(2)}%
            </span>
            <span className="ml-auto text-neutral-500">block {String(e.blockNumber)}</span>
          </div>

          <blockquote className="mt-3 border-l-2 border-indigo-500/40 pl-3 text-sm leading-relaxed text-neutral-200">
            {e.reason}
          </blockquote>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <span className="text-neutral-500">
              your share of the cost{" "}
              <span className="text-neutral-300">${e.attributedCost.toFixed(4)}</span>
            </span>
            <a
              href={explorerTx(e.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 transition hover:text-indigo-300"
            >
              Verify onchain →
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
