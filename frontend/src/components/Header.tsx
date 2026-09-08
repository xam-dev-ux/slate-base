"use client";

import { useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { MarketSessionBadge } from "./MarketSession";
import { HowItWorksModal } from "./HowItWorksModal";

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4 sm:gap-6 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight text-white">
          Slate
        </Link>

        <nav className="hidden items-center gap-5 text-sm text-neutral-400 sm:flex">
          <Link href="/" className="transition hover:text-white">
            Funds
          </Link>
          <Link href="/portfolio" className="transition hover:text-white">
            Portfolio
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-3 sm:flex">
            <HowItWorksModal />
            <MarketSessionBadge />
          </div>
          <ConnectButton showBalance={false} chainStatus="icon" />
          {/* Funds/Portfolio/How it works have nowhere to go below sm — this is the only way to
              reach them on a phone, not a cosmetic extra. */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-neutral-300 transition hover:border-white/20 hover:text-white sm:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              {menuOpen ? (
                <path
                  d="M4 4l10 10M14 4L4 14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M2 5h14M2 9h14M2 13h14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-white/10 bg-neutral-950 px-4 py-4 sm:hidden">
          <nav className="flex flex-col gap-4 text-sm text-neutral-300">
            <Link href="/" onClick={() => setMenuOpen(false)} className="transition hover:text-white">
              Funds
            </Link>
            <Link
              href="/portfolio"
              onClick={() => setMenuOpen(false)}
              className="transition hover:text-white"
            >
              Portfolio
            </Link>
            {/* No close-on-click wrapper here, unlike the Links above: closing the mobile menu
                unmounts this whole subtree, and since the click that opens the modal bubbles up
                to a parent onClick just as readily as one that should close the menu, that wrapper
                was unmounting HowItWorksModal (and its `open` state) before the portal could ever
                render — the modal simply never appeared on mobile. */}
            <HowItWorksModal />
            <MarketSessionBadge />
          </nav>
        </div>
      )}
    </header>
  );
}
