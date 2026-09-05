import { formatUnits } from "viem";

/// NAV and all USDC-denominated values in the fund are 6-decimal.
export function formatUsd(value: bigint | undefined, opts?: { maximumFractionDigits?: number }) {
  if (value === undefined) return "—";
  const n = Number(formatUnits(value, 6));
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts?.maximumFractionDigits ?? 2,
  });
}

/// Share tokens are 18-decimal.
export function formatShares(value: bigint | undefined, digits = 4) {
  if (value === undefined) return "—";
  const n = Number(formatUnits(value, 18));
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/// Components are 8-decimal (every Coinbase Tokenized Stock, verified on-chain).
export function formatUnitsDp(value: bigint | undefined, decimals: number, digits = 4) {
  if (value === undefined) return "—";
  const n = Number(formatUnits(value, decimals));
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatBps(bps: number | bigint | undefined) {
  if (bps === undefined) return "—";
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

export function shortAddress(address: string | undefined) {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatRelativeTime(secondsAgo: number) {
  if (secondsAgo < 60) return `${Math.floor(secondsAgo)}s ago`;
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
  return `${Math.floor(secondsAgo / 86400)}d ago`;
}

export function formatTimestamp(ts: bigint | number | undefined) {
  if (ts === undefined) return "—";
  const ms = Number(ts) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}
