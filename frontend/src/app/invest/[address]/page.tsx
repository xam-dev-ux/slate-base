"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { isAddress, parseUnits, type Address } from "viem";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { erc20Abi, slateFundAbi } from "@/lib/abis";
import { USDC } from "@/lib/config";
import { useFundSummary, useShareInfo, useComponents } from "@/lib/useFund";
import { formatUsd, formatShares, formatBps } from "@/lib/format";
import { fetchSwapLegs, type SwapLeg } from "@/lib/zeroex";
import { StaleFeedBanner } from "@/components/MarketSession";

/// Kept outside the component so the memo around it stays analysable — a try/catch inside
/// `useMemo` defeats the React compiler's memoization.
function parseUsdc(input: string): bigint {
  try {
    return parseUnits(input || "0", 6);
  } catch {
    return 0n;
  }
}

export default function InvestPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = use(params);
  const fund = raw as Address;
  const { address: user, isConnected } = useAccount();

  const [amount, setAmount] = useState("100");
  const [legs, setLegs] = useState<SwapLeg[] | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>();
  const [depositHash, setDepositHash] = useState<`0x${string}` | undefined>();

  const summary = useFundSummary(isAddress(raw) ? fund : undefined);
  const share = useShareInfo(summary.share);
  const components = useComponents(fund, Number(summary.componentsLength ?? 0n));

  const { writeContractAsync, isPending } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } =
    useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: isDepositConfirming, isSuccess: isDepositSuccess } =
    useWaitForTransactionReceipt({ hash: depositHash });
  const isConfirming = isApproveConfirming || isDepositConfirming;

  const usdcAmount = useMemo(() => parseUsdc(amount), [amount]);

  const { data: usdcBalance } = useReadContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: user ? [user] : undefined,
    query: { enabled: Boolean(user) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "allowance",
    args: user ? [user, fund] : undefined,
    query: { enabled: Boolean(user) },
  });

  const { data: userShares } = useReadContract({
    address: summary.share,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: user ? [user] : undefined,
    query: { enabled: Boolean(user && summary.share) },
  });

  // Split the deposit by target weight — the fund validates each leg against Chainlink regardless.
  const plannedLegs = useMemo(
    () =>
      components.map((c) => ({
        token: c.token,
        symbol: c.symbol,
        targetWeightBps: c.targetWeightBps,
        sellAmount: (usdcAmount * BigInt(c.targetWeightBps)) / 10_000n,
      })),
    [components, usdcAmount]
  );

  const needsApproval =
    allowance === undefined || (allowance as bigint) < usdcAmount;

  // The cap bounds the current value of the position, so the room left is the cap minus what the
  // stake is worth right now — not minus everything ever deposited.
  const positionValue =
    summary.totalNAV !== undefined && share.totalSupply && share.totalSupply > 0n && userShares
      ? (summary.totalNAV * (userShares as bigint)) / share.totalSupply
      : 0n;

  const walletCapLeft =
    summary.maxPositionPerWallet !== undefined
      ? summary.maxPositionPerWallet > positionValue
        ? summary.maxPositionPerWallet - positionValue
        : 0n
      : undefined;

  const overWalletCap =
    walletCapLeft !== undefined && usdcAmount > walletCapLeft;

  const estimatedShares =
    summary.navPerShare !== undefined && summary.navPerShare > 0n && usdcAmount > 0n
      ? (usdcAmount * 10n ** 18n) / summary.navPerShare
      : undefined;

  async function getQuote() {
    setIsQuoting(true);
    setQuoteError(null);
    try {
      const result = await fetchSwapLegs({ fund, components: plannedLegs });
      setLegs(result);
    } catch (error) {
      setQuoteError(error instanceof Error ? error.message : "Could not fetch a quote.");
      setLegs(null);
    } finally {
      setIsQuoting(false);
    }
  }

  async function approve() {
    const h = await writeContractAsync({
      address: USDC,
      abi: erc20Abi,
      functionName: "approve",
      args: [fund, usdcAmount],
    });
    setApproveHash(h);
    await refetchAllowance();
  }

  async function deposit() {
    if (!legs) return;
    const sellAmounts = components.map(
      (c) => legs.find((l) => l.token.toLowerCase() === c.token.toLowerCase())?.sellAmount ?? 0n
    );
    const calldata = components.map(
      (c) =>
        legs.find((l) => l.token.toLowerCase() === c.token.toLowerCase())?.data ?? ("0x" as const)
    );

    const h = await writeContractAsync({
      address: fund,
      abi: slateFundAbi,
      functionName: "deposit",
      args: [usdcAmount, sellAmounts, calldata],
    });
    setDepositHash(h);
  }

  if (!isAddress(raw)) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20">
        <p className="text-sm text-neutral-400">That is not a valid fund address.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href={`/funds/${fund}`}
        className="text-xs text-neutral-500 transition hover:text-neutral-300"
      >
        ← Back to fund
      </Link>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
        Invest in {share.name ?? "…"}
      </h1>

      {(summary.navUnavailable || summary.feedsHealthy === false) && (
        <div className="mt-6">
          <StaleFeedBanner staleFeed={summary.staleFeed} />
        </div>
      )}

      {summary.depositsPaused && (
        <p className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Deposits are currently paused by the operator. Redemptions remain open.
        </p>
      )}

      <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <label htmlFor="amount" className="block text-sm text-neutral-300">
          Amount to deposit
        </label>
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-4 py-3">
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setLegs(null);
            }}
            className="w-full bg-transparent text-lg text-white outline-none"
            placeholder="0.00"
          />
          <span className="font-mono text-sm text-neutral-500">USDC</span>
        </div>

        <div className="mt-2 flex flex-wrap gap-4 text-xs text-neutral-500">
          <span>Balance: {formatUsd(usdcBalance as bigint | undefined)}</span>
          <span>Room left in your cap: {formatUsd(walletCapLeft)}</span>
        </div>

        {overWalletCap && (
          <p className="mt-3 text-xs text-amber-400">
            That exceeds the per-wallet cap for this fund. The caps exist because this contract
            custodies real assets and has not been audited.
          </p>
        )}

        {estimatedShares !== undefined && usdcAmount > 0n && (
          <p className="mt-4 text-sm text-neutral-300">
            {formatUsd(usdcAmount)} → ≈ {formatShares(estimatedShares)} {share.symbol} at{" "}
            {formatUsd(summary.navPerShare)}/share
          </p>
        )}

        <div className="mt-5 border-t border-white/5 pt-5">
          <h3 className="text-xs uppercase tracking-wider text-neutral-500">Per-component split</h3>
          <ul className="mt-3 space-y-1.5">
            {plannedLegs.map((l) => (
              <li key={l.token} className="flex items-center justify-between text-sm">
                <span className="text-neutral-300">
                  {l.symbol ?? "…"}{" "}
                  <span className="text-xs text-neutral-600">
                    {formatBps(l.targetWeightBps)}
                  </span>
                </span>
                <span className="font-mono text-xs text-neutral-400">
                  {formatUsd(l.sellAmount)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={getQuote}
            disabled={!isConnected || usdcAmount === 0n || isQuoting}
            className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-neutral-200 transition hover:border-white/30 disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            {isQuoting ? "Fetching quote…" : legs ? "Refresh quote" : "Get quote"}
          </button>

          {needsApproval ? (
            <button
              type="button"
              onClick={approve}
              disabled={!isConnected || usdcAmount === 0n || isPending || isConfirming}
              className="rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:bg-white/5 disabled:text-neutral-500"
            >
              {isPending || isConfirming ? "Confirming…" : "Approve USDC"}
            </button>
          ) : (
            <button
              type="button"
              onClick={deposit}
              disabled={
                !isConnected ||
                !legs ||
                usdcAmount === 0n ||
                overWalletCap ||
                summary.depositsPaused ||
                isPending ||
                isConfirming
              }
              className="rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:bg-white/5 disabled:text-neutral-500"
            >
              {isPending || isConfirming ? "Confirming…" : "Deposit"}
            </button>
          )}
        </div>

        {!needsApproval && !legs && usdcAmount > 0n && !isQuoting && (
          <p className="mt-3 text-xs text-neutral-500">
            Get a quote above first — the deposit needs the swap legs it produces.
          </p>
        )}

        {quoteError && <p className="mt-4 text-xs leading-relaxed text-amber-400">{quoteError}</p>}

        {isApproveSuccess && !depositHash && (
          <p className="mt-4 text-sm text-emerald-400">
            USDC approved. Get a quote, then deposit below.
          </p>
        )}

        {isDepositSuccess && (
          <p className="mt-4 text-sm text-emerald-400">
            Deposit confirmed.{" "}
            <Link href="/portfolio" className="underline">
              View your portfolio
            </Link>
          </p>
        )}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-neutral-600">
        Swap routes are built off-chain and executed through the fund. The contract does not trust
        that calldata: it prices every leg against the component&apos;s Chainlink feed and reverts
        if the result lands outside the slippage bound.
      </p>
    </div>
  );
}
