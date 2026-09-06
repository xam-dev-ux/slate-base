"use client";

import type { Address } from "viem";
import { useAccount } from "wagmi";
import { useRebalanceHistory, useShareHistory } from "@/lib/useFund";
import { fractionAt } from "@/lib/shareHistory";
import { formatUsd, shortAddress } from "@/lib/format";
import { explorerTx, explorerAddress } from "@/lib/config";

/// The centrepiece of the app: the fund's own account of every rebalance it has performed, quoted
/// verbatim from the description it wrote on-chain. Each row links out so the reader can verify
/// the same log independently rather than taking this table's word for it.
///
/// A viewer's share of each rebalance is computed from the stake they actually held at that block,
/// replayed from the share token's transfer log — not from what they hold today, which would
/// invoice new depositors for costs they never bore.
export function RebalanceHistory({ fund, share }: { fund: Address; share?: Address }) {
  const { address: user } = useAccount();
  const { data: records, isLoading } = useRebalanceHistory(fund, share);
  const { data: checkpoints, isLoading: historyLoading } = useShareHistory(share, user);

  if (isLoading) {
    return <p className="text-sm text-neutral-500">Reading rebalance logs…</p>;
  }

  if (!records || records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
        <p className="text-sm text-neutral-400">No rebalances yet.</p>
        <p className="mt-2 text-xs text-neutral-600">
          When a component drifts past the threshold, anyone can trigger one — and the reason will
          appear here, written onchain by the fund itself.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {records.map((r) => {
        const cost = r.navBefore > r.navAfter ? r.navBefore - r.navAfter : 0n;

        const heldFraction =
          user && checkpoints ? fractionAt(checkpoints, r.blockNumber, r.logIndex) : 0;
        const yourCost = heldFraction > 0 ? (Number(cost) / 1e6) * heldFraction : 0;

        return (
          <article
            key={`${r.txHash}-${r.rebalanceId}`}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 font-mono text-xs text-indigo-300">
                #{String(r.rebalanceId)}
              </span>
              {r.announcementId && (
                <span className="font-mono text-xs text-neutral-500">{r.announcementId}</span>
              )}
              {user && !historyLoading && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    heldFraction > 0
                      ? "bg-emerald-500/10 text-emerald-300"
                      : "bg-white/5 text-neutral-500"
                  }`}
                  title={
                    heldFraction > 0
                      ? "Your stake at this block, replayed from the share token's transfer log"
                      : "You held no shares when this rebalance happened"
                  }
                >
                  {heldFraction > 0
                    ? `you held ${(heldFraction * 100).toFixed(2)}%`
                    : "not holding then"}
                </span>
              )}
              <span className="ml-auto text-xs text-neutral-500">
                block {String(r.blockNumber)}
              </span>
            </div>

            {/* Quoted verbatim — this string lives onchain. */}
            <blockquote className="mt-3 border-l-2 border-indigo-500/40 pl-3 text-sm leading-relaxed text-neutral-200">
              {r.reason}
            </blockquote>

            <dl className="mt-4 grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-neutral-500">NAV before</dt>
                <dd className="mt-0.5 text-neutral-300">{formatUsd(r.navBefore)}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">NAV after</dt>
                <dd className="mt-0.5 text-neutral-300">{formatUsd(r.navAfter)}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Cost</dt>
                <dd className="mt-0.5 text-neutral-300">
                  {cost > 0n ? formatUsd(cost) : "—"}
                  {user && heldFraction > 0 && cost > 0n && (
                    <span className="ml-1 text-neutral-500">
                      (yours ${yourCost.toFixed(4)})
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Triggered by</dt>
                <dd className="mt-0.5">
                  <a
                    href={explorerAddress(r.caller)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-neutral-300 transition hover:text-indigo-300"
                  >
                    {shortAddress(r.caller)}
                  </a>
                </dd>
              </div>
            </dl>

            <a
              href={explorerTx(r.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-xs text-indigo-400 transition hover:text-indigo-300"
            >
              Verify this announcement on BaseScan →
            </a>
          </article>
        );
      })}
    </div>
  );
}
