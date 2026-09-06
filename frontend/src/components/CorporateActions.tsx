"use client";

import type { Component } from "@/lib/useFund";
import { useCorporateActions, describeAction } from "@/lib/useCorporateActions";
import { formatTimestamp, shortAddress } from "@/lib/format";
import { explorerTx } from "@/lib/config";

export function CorporateActions({ components }: { components: Component[] }) {
  const { data: actions, isLoading } = useCorporateActions(components);

  return (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
        Corporate actions
      </h2>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-neutral-600">
        These are real shares, so dividends and splits actually reach holders. Coinbase applies them
        by raising each token&apos;s multiplier: your balance does not move, but the number of real
        shares it represents does. Anything that happens to a component shows up here.
      </p>

      <div className="mt-4">
        {isLoading ? (
          <p className="text-sm text-neutral-500">Scanning component logs…</p>
        ) : !actions || actions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6">
            <p className="text-sm text-neutral-400">No corporate action yet.</p>
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">
              No Coinbase Tokenized Stock has rebased since launch — every component still reports a
              multiplier of exactly 1.0. When the first dividend or split lands, it will appear here
              with the exact ratio, and the &quot;Shares owned&quot; column above will move while
              token balances stay put.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {actions.map((a) => (
              <li
                key={`${a.txHash}-${a.token}`}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-white">{a.symbol ?? shortAddress(a.token)}</span>
                  <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-300">
                    {describeAction(a)}
                  </span>
                  {a.immediate && (
                    <span
                      className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300"
                      title="Applied through the deprecated instant setter, bypassing the scheduling window"
                    >
                      instant override
                    </span>
                  )}
                  {a.cancelled && (
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-neutral-400">
                      superseded
                    </span>
                  )}
                  <span className="ml-auto text-xs text-neutral-500">
                    effective {formatTimestamp(a.effectiveAt)}
                  </span>
                </div>

                <p className="mt-3 font-mono text-xs text-neutral-400">
                  {(Number(a.oldMultiplier) / 1e18).toFixed(6)} →{" "}
                  {(Number(a.newMultiplier) / 1e18).toFixed(6)}
                </p>

                <a
                  href={explorerTx(a.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-xs text-indigo-400 transition hover:text-indigo-300"
                >
                  View on BaseScan →
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
