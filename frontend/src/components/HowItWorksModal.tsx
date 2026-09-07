"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const SECTIONS = [
  {
    title: "One deposit, a whole basket",
    body: "Deposit USDC once and get exposure to several Coinbase Tokenized Stocks in a single position — no manual swaps, no juggling four tickers yourself.",
  },
  {
    title: "What you hold is a real, transferable token",
    body: "Your position isn't an entry in our database — it's a standard B20 token in your own wallet. Send it, hold it, or exit by simply selling it instead of redeeming through the app.",
  },
  {
    title: "Dividends and splits, handled for you",
    body: "Coinbase Tokenized Stocks reflect corporate actions through a multiplier rather than changing your balance. Slate reads it directly, so what you see is what you actually own — not a stale raw balance.",
  },
  {
    title: "Rebalancing is public, and anyone can do it",
    body: "When the basket drifts from target, anyone can trigger a rebalance and earn a small reward for it — there's no keeper, no backend holding keys. The cost is shared proportionally across every holder, and the reason is written onchain in plain English, not summarised after the fact.",
  },
  {
    title: "The operator can't touch your funds",
    body: "There's no withdraw function for the operator — it isn't missing a permission, it doesn't exist. And you can always exit in kind, even if the price feeds are frozen or the swap router is down.",
  },
  {
    title: "Pricing can fall back to the pool's own average, if the operator opts in",
    body: "Aerodrome's pools keep trading these stocks around the clock, even when Chainlink hasn't published a fresh price in days — a long weekend, a holiday. By default the fund just pauses pricing rather than trust anything else. An operator can opt a fund into a fallback: a time-weighted average pulled straight from the pool, far harder to move than a single spot price, but still a weaker guarantee than a live independent oracle. Check a fund's \"Pricing mode\" panel to see whether this is active.",
  },
];

export function HowItWorksModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-white/20 hover:text-white"
      >
        <span
          aria-hidden
          className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] leading-none"
        >
          ?
        </span>
        How it works
      </button>

      {/* Portalled to <body>: the header's own `backdrop-blur` establishes a containing block
          for `position: fixed` descendants, which would otherwise pin this to the header's own
          72px box instead of the viewport. */}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="how-it-works-title"
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />

            <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-neutral-950 p-6 shadow-2xl shadow-black/50 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <h2 id="how-it-works-title" className="text-xl font-semibold text-white">
                  What is Slate?
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="-mr-2 -mt-2 rounded-full p-2 text-neutral-500 transition hover:bg-white/5 hover:text-white"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M2 2L14 14M14 2L2 14"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                Onchain index funds of Coinbase Tokenized Stocks on Base — built so you never have
                to trust that a manager did what they said.
              </p>

              <ol className="mt-6 space-y-5">
                {SECTIONS.map((s, i) => (
                  <li key={s.title} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 font-mono text-xs text-indigo-300">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="text-sm font-medium text-white">{s.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-neutral-400">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-7 w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-400"
              >
                Got it
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
