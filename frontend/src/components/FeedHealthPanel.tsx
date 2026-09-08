"use client";

import type { Component } from "@/lib/useFund";
import { useFeedHealth } from "@/lib/useFund";
import { formatRelativeTime, shortAddress } from "@/lib/format";
import { explorerAddress } from "@/lib/config";

export function FeedHealthPanel({
  components,
  stalenessTolerance,
}: {
  components: Component[];
  stalenessTolerance?: bigint;
}) {
  const feeds = useFeedHealth(components, stalenessTolerance);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
      <h3 className="font-medium text-white">Oracle health</h3>
      <p className="mt-1 text-xs text-neutral-500">
        Chainlink feeds run 24/5 and publish on deviation or heartbeat, so a component can be hours
        behind even during a session.
      </p>

      {feeds.isRpcError && (
        <p className="mt-3 flex items-center gap-2 text-xs text-amber-400">
          Couldn&apos;t reach the RPC to check feed freshness — this is a rate limit on the public
          endpoint, not the feeds themselves.
          <button
            type="button"
            onClick={() => feeds.refetch()}
            className="rounded border border-amber-500/30 px-2 py-0.5 text-amber-300 transition hover:border-amber-500/50"
          >
            Retry
          </button>
        </p>
      )}

      <ul className="mt-4 space-y-2.5">
        {feeds.map((f) => (
          <li key={f.feed} className="flex items-center gap-3 text-sm">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                f.isStale === undefined
                  ? "bg-neutral-600"
                  : f.isStale
                    ? "bg-amber-400"
                    : "bg-emerald-400"
              }`}
            />
            <span className="font-medium text-neutral-200">{f.symbol ?? "…"}</span>
            <a
              href={explorerAddress(f.feed)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-neutral-600 transition hover:text-neutral-400"
            >
              {shortAddress(f.feed)}
            </a>
            <span className="ml-auto text-xs text-neutral-400">
              {f.ageSeconds !== undefined ? formatRelativeTime(f.ageSeconds) : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
