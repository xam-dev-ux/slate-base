"use client";

import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type Address } from "viem";
import { CHAIN, GENESIS_BLOCK } from "./config";
import { getLogsChunked } from "./getLogsChunked";
import type { Component } from "./useFund";

/// The scheduled setter, and the canonical path for corporate actions. Carries both multipliers
/// and the timestamp the change takes effect, so the ratio is readable straight off the log.
const UI_MULTIPLIER_UPDATED = parseAbiItem(
  "event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)"
);

/// The deprecated instant setter. It emits alongside `UIMultiplierUpdated` in the same transaction,
/// so the two cannot be told apart by name — only by whether this one co-occurs.
const MULTIPLIER_UPDATED = parseAbiItem("event MultiplierUpdated(uint256 multiplier)");

const UI_MULTIPLIER_CANCELLED = parseAbiItem(
  "event UIMultiplierUpdateCancelled(uint256 cancelledMultiplier, uint256 cancelledEffectiveAt)"
);

export type CorporateAction = {
  token: Address;
  symbol?: string;
  oldMultiplier: bigint;
  newMultiplier: bigint;
  effectiveAt: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
  /// Instant overrides bypass the scheduling window; the scheduled path is the routine one.
  immediate: boolean;
  cancelled: boolean;
};

/// Classifies a multiplier move by its ratio. A reinvested dividend nudges the multiplier up a
/// little; a split multiplies it. The distinction is presentational — both mean the same thing for
/// a holder, that their real share count moved without their balance changing.
export function describeAction(action: CorporateAction): string {
  if (action.oldMultiplier === 0n) return "Multiplier set";
  const ratio = Number(action.newMultiplier) / Number(action.oldMultiplier);

  if (ratio > 1.5) return `${ratio.toFixed(2)}-for-1 split`;
  if (ratio < 0.75) return `1-for-${(1 / ratio).toFixed(2)} reverse split`;
  if (ratio > 1) return `Dividend reinvested, +${((ratio - 1) * 100).toFixed(2)}%`;
  if (ratio < 1) return `Multiplier reduced ${((1 - ratio) * 100).toFixed(2)}%`;
  return "Multiplier unchanged";
}

/// Watches every component for multiplier changes — the mechanism by which Coinbase reflects real
/// dividends and splits on tokenized stocks. This is what separates holding the underlying from
/// synthetic exposure: the corporate action actually reaches the holder.
///
/// No Coinbase Tokenized Stock has rebased yet, so this reads empty today. That is the honest
/// current state, not a failure.
export function useCorporateActions(components: Component[]) {
  const client = usePublicClient({ chainId: CHAIN.id });
  const tokens = components.map((c) => c.token).join(",");

  return useQuery({
    queryKey: ["corporate-actions", tokens],
    enabled: Boolean(client) && components.length > 0,
    staleTime: 5 * 60_000,
    retry: 2,
    queryFn: async (): Promise<CorporateAction[]> => {
      if (!client) return [];

      // These tokens predate any Slate fund, so a genuinely complete scan would need to start at
      // their own deployment block, not the factory's. Bounding from GENESIS_BLOCK instead is a
      // real tradeoff, made acceptable only because no Coinbase Tokenized Stock has rebased yet
      // (see the module doc above) — there is nothing earlier to miss today. Revisit this if that
      // stops being true.
      //
      // One combined scan across every component address and all three event types, rather than
      // 3 separate series per component (up to 12 chunked series total on a 4-component basket):
      // that many concurrent RPC calls against a rate-limited public endpoint is what left this
      // stuck on "Scanning component logs…" far longer than the data actually took to fetch.
      const logs = (await getLogsChunked(client, {
        address: components.map((c) => c.token),
        events: [UI_MULTIPLIER_UPDATED, MULTIPLIER_UPDATED, UI_MULTIPLIER_CANCELLED],
        fromBlock: GENESIS_BLOCK,
      })) as Awaited<
        ReturnType<
          typeof client.getLogs<
            undefined,
            readonly [
              typeof UI_MULTIPLIER_UPDATED,
              typeof MULTIPLIER_UPDATED,
              typeof UI_MULTIPLIER_CANCELLED,
            ]
          >
        >
      >;

      const byToken = new Map(components.map((c) => [c.token.toLowerCase(), c]));

      const results: CorporateAction[] = [];
      for (const log of logs) {
        if (log.eventName !== "UIMultiplierUpdated") continue;
        const component = byToken.get(log.address.toLowerCase());
        if (!component) continue;

        // Classify by co-occurrence in the same transaction, never by event name.
        const sameTx = logs.filter(
          (l) => l.transactionHash === log.transactionHash && l.address === log.address
        );
        const immediate = sameTx.some((l) => l.eventName === "MultiplierUpdated");
        const cancelled = sameTx.some((l) => l.eventName === "UIMultiplierUpdateCancelled");

        results.push({
          token: component.token,
          symbol: component.symbol,
          oldMultiplier: log.args.oldMultiplier ?? 0n,
          newMultiplier: log.args.newMultiplier ?? 0n,
          effectiveAt: log.args.effectiveAtTimestamp ?? 0n,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          immediate,
          cancelled,
        });
      }

      return results.sort((a, b) => Number(b.blockNumber - a.blockNumber));
    },
  });
}
