"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useFundSummary, useShareInfo, useComponents } from "@/lib/useFund";
import { formatUsd, formatBps } from "@/lib/format";

export function FundCard({ address }: { address: Address }) {
  const summary = useFundSummary(address);
  const share = useShareInfo(summary.share);
  const components = useComponents(address, Number(summary.componentsLength ?? 0n));

  return (
    <Link
      href={`/funds/${address}`}
      className="group flex flex-col rounded-xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/20 hover:bg-white/[0.05]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{share.name ?? "Loading…"}</h3>
          <p className="mt-0.5 font-mono text-xs text-neutral-500">{share.symbol ?? "—"}</p>
        </div>
        {summary.depositsPaused && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
            Deposits paused
          </span>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {components.map((c) => (
          <span
            key={c.token}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-neutral-300"
          >
            {c.symbol ?? "…"}{" "}
            <span className="text-neutral-500">{formatBps(c.targetWeightBps)}</span>
          </span>
        ))}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/5 pt-5">
        <div>
          <dt className="text-xs text-neutral-500">TVL</dt>
          <dd className="mt-1 text-base font-medium text-white">
            {summary.navUnavailable ? "Oracles behind" : formatUsd(summary.totalNAV)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Rebalances</dt>
          <dd className="mt-1 text-base font-medium text-white">
            {summary.rebalanceCount !== undefined ? String(summary.rebalanceCount) : "—"}
          </dd>
        </div>
      </dl>

      <span className="mt-6 text-sm font-medium text-indigo-400 transition group-hover:text-indigo-300">
        View fund →
      </span>
    </Link>
  );
}
