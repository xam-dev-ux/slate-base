"use client";

import { useEffect, useState } from "react";

export type SessionState = {
  isOpen: boolean;
  label: string;
  detail: string;
};

/// Coinbase's Chainlink TRV feeds run 24/5 — regular, pre-market, post-market and overnight
/// sessions on weekdays, frozen at the Friday close across the weekend. This is a display hint
/// only; the contract's own staleness check is the source of truth for whether the fund can price
/// itself, which is why every action gates on `feedsHealthy()` rather than on this clock.
export function getSessionState(now = new Date()): SessionState {
  const day = now.getUTCDay(); // 0 Sun .. 6 Sat
  const hour = now.getUTCHours();
  const minutes = now.getUTCMinutes();
  const timeUtc = hour + minutes / 60;

  if (day === 6 || day === 0) {
    return {
      isOpen: false,
      label: "Markets closed",
      detail: "US markets reopen Monday. Feeds hold the Friday close until then.",
    };
  }

  // US regular session is 13:30–20:00 UTC; extended sessions run either side of it.
  if (timeUtc >= 13.5 && timeUtc < 20) {
    return { isOpen: true, label: "Regular session", detail: "US markets are open." };
  }
  if (timeUtc >= 8 && timeUtc < 13.5) {
    return { isOpen: true, label: "Pre-market", detail: "Extended-hours trading." };
  }
  if (timeUtc >= 20 && timeUtc < 24) {
    return { isOpen: true, label: "Post-market", detail: "Extended-hours trading." };
  }
  return { isOpen: true, label: "Overnight session", detail: "Overnight trading window." };
}

export function MarketSessionBadge() {
  const [state, setState] = useState<SessionState | null>(null);

  useEffect(() => {
    const update = () => setState(getSessionState());
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!state) return null;

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300"
      title={state.detail}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${state.isOpen ? "bg-emerald-400" : "bg-amber-400"}`}
      />
      {state.label}
    </span>
  );
}

/// Shown when the contract itself reports a stale feed, which blocks pricing-dependent actions.
export function StaleFeedBanner({ staleFeed }: { staleFeed?: string }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <p className="font-medium">Pricing is paused while the oracles are behind.</p>
      <p className="mt-1 text-amber-200/80">
        US market sessions are closed, so Chainlink feeds are holding their last close. Deposits,
        redemptions and rebalances resume when the feeds update.{" "}
        <span className="font-medium text-amber-100">In-kind redemption remains available</span> —
        it needs no oracle at all.
      </p>
      {staleFeed && (
        <p className="mt-2 font-mono text-xs text-amber-200/60">Stale feed: {staleFeed}</p>
      )}
    </div>
  );
}
