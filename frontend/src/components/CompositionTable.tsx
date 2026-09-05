"use client";

import type { Component } from "@/lib/useFund";
import { formatBps, formatUnitsDp, shortAddress } from "@/lib/format";
import { explorerAddress } from "@/lib/config";

export function CompositionTable({ components }: { components: Component[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase tracking-wider text-neutral-500">
            <th className="px-4 py-3 font-medium">Component</th>
            <th className="px-4 py-3 font-medium">Target</th>
            <th className="px-4 py-3 font-medium">Current</th>
            <th className="px-4 py-3 font-medium">Drift</th>
            <th className="px-4 py-3 font-medium">Tokens held</th>
            <th className="px-4 py-3 font-medium">
              <span
                className="cursor-help border-b border-dotted border-neutral-600"
                title="1 token ≠ 1 share. Coinbase reflects dividends and splits by raising the multiplier, so your real share count grows without your balance changing."
              >
                Shares owned
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {components.map((c) => {
            const current = c.currentWeightBps;
            const drift =
              current !== undefined ? current - c.targetWeightBps : undefined;
            const driftPct =
              drift !== undefined ? Math.min(Math.abs(drift) / 100, 20) * 5 : 0;

            return (
              <tr key={c.token} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3">
                  <a
                    href={explorerAddress(c.token)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-white transition hover:text-indigo-300"
                  >
                    {c.symbol ?? shortAddress(c.token)}
                  </a>
                </td>
                <td className="px-4 py-3 text-neutral-400">{formatBps(c.targetWeightBps)}</td>
                <td className="px-4 py-3 text-neutral-200">
                  {current !== undefined ? formatBps(current) : "—"}
                </td>
                <td className="px-4 py-3">
                  {drift === undefined ? (
                    "—"
                  ) : (
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          Math.abs(drift) > 500
                            ? "text-amber-400"
                            : "text-neutral-400"
                        }
                      >
                        {drift > 0 ? "+" : ""}
                        {(drift / 100).toFixed(2)}pp
                      </span>
                      <span className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
                        <span
                          className={`block h-full ${
                            Math.abs(drift) > 500 ? "bg-amber-400" : "bg-indigo-400"
                          }`}
                          style={{ width: `${driftPct}%` }}
                        />
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                  {formatUnitsDp(c.balance, c.tokenDecimals)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                  {formatUnitsDp(c.scaledBalance, c.tokenDecimals)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
