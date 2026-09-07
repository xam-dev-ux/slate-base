"use client";

import { use } from "react";
import Link from "next/link";
import { isAddress, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useFundSummary, useShareInfo, useComponents } from "@/lib/useFund";
import { erc20Abi, slateFundAbi } from "@/lib/abis";
import { formatUsd, formatShares, shortAddress, formatBps } from "@/lib/format";
import { explorerAddress } from "@/lib/config";
import { CompositionTable } from "@/components/CompositionTable";
import { RebalanceHistory } from "@/components/RebalanceHistory";
import { RebalancePanel } from "@/components/RebalancePanel";
import { FeedHealthPanel } from "@/components/FeedHealthPanel";
import { StaleFeedBanner } from "@/components/MarketSession";
import { RedeemInKindButton } from "@/components/RedeemInKind";
import { CorporateActions } from "@/components/CorporateActions";
import { AddToWalletButton } from "@/components/AddToWalletButton";

export default function FundPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = use(params);
  const fund = raw as Address;
  const { address: user } = useAccount();

  const summary = useFundSummary(isAddress(raw) ? fund : undefined);
  const share = useShareInfo(summary.share);
  const components = useComponents(fund, Number(summary.componentsLength ?? 0n));

  const { data: userShares } = useReadContract({
    address: summary.share,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: user ? [user] : undefined,
    query: { enabled: Boolean(summary.share && user) },
  });

  const { data: stalenessTolerance } = useReadContract({
    address: fund,
    abi: slateFundAbi,
    functionName: "feedStalenessTolerance",
    query: { enabled: isAddress(raw) },
  });

  if (!isAddress(raw)) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20">
        <p className="text-sm text-neutral-400">That is not a valid fund address.</p>
      </div>
    );
  }

  // A well-formed address that answers none of the fund's calls simply is not a Slate fund —
  // better to say so than to spin on "Loading…" forever. But an RPC-level failure (rate limit,
  // timeout) looks identical to that in the raw data, so it's excluded explicitly rather than
  // reported as "no fund here".
  const notAFund = !summary.isLoading && !summary.isRpcError && summary.share === undefined;
  if (notAFund) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20">
        <Link href="/" className="text-xs text-neutral-500 transition hover:text-neutral-300">
          ← All funds
        </Link>
        <p className="mt-6 text-sm text-neutral-300">
          No Slate fund lives at this address on Base mainnet.
        </p>
        <p className="mt-2 font-mono text-xs text-neutral-600">{raw}</p>
      </div>
    );
  }

  if (summary.isRpcError && summary.share === undefined) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20">
        <Link href="/" className="text-xs text-neutral-500 transition hover:text-neutral-300">
          ← All funds
        </Link>
        <p className="mt-6 text-sm text-neutral-300">
          Couldn&apos;t reach the RPC to load this fund. This is usually a rate limit on the public
          endpoint, not a problem with the fund itself.
        </p>
        <button
          onClick={() => summary.refetch()}
          className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:border-white/30 hover:text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  const shareFraction =
    userShares && share.totalSupply && share.totalSupply > 0n
      ? Number(userShares) / Number(share.totalSupply)
      : undefined;

  const userValue =
    shareFraction !== undefined && summary.totalNAV !== undefined
      ? BigInt(Math.floor(Number(summary.totalNAV) * shareFraction))
      : undefined;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/" className="text-xs text-neutral-500 transition hover:text-neutral-300">
        ← All funds
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            {share.name ?? "Loading…"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
            <span className="font-mono">{share.symbol}</span>
            <a
              href={explorerAddress(fund)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono transition hover:text-neutral-300"
            >
              fund {shortAddress(fund)}
            </a>
            {summary.share && (
              <a
                href={explorerAddress(summary.share)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono transition hover:text-neutral-300"
              >
                share token {shortAddress(summary.share)}
              </a>
            )}
            {summary.share && user && (
              <AddToWalletButton address={summary.share} symbol={share.symbol} />
            )}
          </div>
        </div>

        <dl className="flex flex-wrap gap-8">
          <div>
            <dt className="text-xs text-neutral-500">NAV / share</dt>
            <dd className="mt-1 text-xl font-medium text-white">
              {summary.navUnavailable ? "—" : formatUsd(summary.navPerShare)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">TVL</dt>
            <dd className="mt-1 text-xl font-medium text-white">
              {summary.navUnavailable ? "—" : formatUsd(summary.totalNAV)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Your position</dt>
            <dd className="mt-1 text-xl font-medium text-white">
              {userShares ? formatUsd(userValue) : "—"}
              {userShares !== undefined && userShares > 0n && (
                <span className="ml-2 text-xs text-neutral-500">
                  {formatShares(userShares)} shares
                </span>
              )}
            </dd>
          </div>
        </dl>
      </header>

      {(summary.navUnavailable || summary.feedsHealthy === false) && (
        <div className="mt-6">
          <StaleFeedBanner staleFeed={summary.staleFeed} />
        </div>
      )}

      {share.indexRule && (
        <p className="mt-8 max-w-3xl border-l-2 border-white/10 pl-4 text-sm leading-relaxed text-neutral-400">
          {share.indexRule}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/invest/${fund}`}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400"
        >
          Invest
        </Link>
        {summary.share && userShares !== undefined && userShares > 0n && (
          <RedeemInKindButton fund={fund} share={summary.share} shares={userShares} />
        )}
        <Link
          href={`/verify/${fund}`}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:border-white/30 hover:text-white"
        >
          Verify this yourself
        </Link>
      </div>

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          Composition
        </h2>
        <div className="mt-4">
          <CompositionTable components={components} />
        </div>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <RebalancePanel
          fund={fund}
          possible={summary.rebalancePossible}
          reason={summary.rebalanceReason}
          nextEligibleAt={summary.nextEligibleAt}
          maxDriftBps={summary.maxDriftBps}
          driftThresholdBps={summary.driftThresholdBps}
          callerRewardBps={summary.callerRewardBps}
          totalNAV={summary.totalNAV}
          navUnavailable={summary.navUnavailable}
          components={components}
        />
        <FeedHealthPanel
          components={components}
          stalenessTolerance={stalenessTolerance as bigint | undefined}
        />
      </div>

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          Rebalance history
        </h2>
        <p className="mt-2 max-w-2xl text-xs text-neutral-600">
          Each entry is quoted verbatim from what the fund wrote onchain at the time. Follow any
          link to read the same log yourself.
        </p>
        <div className="mt-4">
          <RebalanceHistory fund={fund} share={summary.share} />
        </div>
      </section>

      <div className="mt-12">
        <CorporateActions components={components} />
      </div>

      <section className="mt-12 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-medium text-white">Operator powers</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
          {share.operatorPowers ??
            "pause deposits, adjust bounded params. Cannot move funds."}
        </p>
        <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-neutral-500">Operator</dt>
            <dd className="mt-1">
              <a
                href={summary.operator ? explorerAddress(summary.operator) : "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-neutral-300 transition hover:text-indigo-300"
              >
                {shortAddress(summary.operator)}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Per-wallet position cap</dt>
            <dd className="mt-1 text-neutral-300">{formatUsd(summary.maxPositionPerWallet)}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Fund value cap</dt>
            <dd className="mt-1 text-neutral-300">
              {formatUsd(summary.totalNAV)} / {formatUsd(summary.maxFundValue)}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-neutral-600">
          There is no withdraw, sweep, or arbitrary-call function on this contract. Drift threshold
          is {formatBps(summary.driftThresholdBps)}; the operator can move it only within hard
          bounds compiled into the contract.
        </p>
      </section>
    </div>
  );
}
