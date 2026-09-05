"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { MarketSessionBadge } from "./MarketSession";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
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

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden sm:block">
            <MarketSessionBadge />
          </span>
          <ConnectButton showBalance={false} chainStatus="icon" />
        </div>
      </div>
    </header>
  );
}
