"use client";

import type { Address } from "viem";
import { useRebalanceHistory } from "@/lib/useFund";
import { formatUsd, shortAddress } from "@/lib/format";
import { explorerTx, explorerAddress } from "@/lib/config";

/// The centrepiece of the app: the fund's own account of every rebalance it has performed, quoted
/// verbatim from the description it wrote on-chain. Each row links out so the reader can verify
/// the same log independently rather than taking this table's word for it.
export function RebalanceHistory({
  fund,
  share,
  userShareFraction,
}: {
  fund: Address;
  share?: Address;
  userShareFraction?: number;
}) {
  const { data: records, isLoading } = useRebalanceHistory(fund, share);

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
        const yourCost =
          userShareFraction && cost > 0n
            ? (Number(cost) / 1e6) * userShareFraction
            : undefined;

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
                  {yourCost !== undefined && yourCost > 0 && (
                    <span className="ml-1 text-neutral-500">
                      (yours ≈ ${yourCost.toFixed(4)})
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
