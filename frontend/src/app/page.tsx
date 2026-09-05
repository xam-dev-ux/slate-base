"use client";

import { useFundList } from "@/lib/useFund";
import { FundCard } from "@/components/FundCard";

const STEPS = [
  {
    title: "Deposit USDC, receive a B20 share token",
    body: "Your shares represent a proportional claim on a custodied basket of Coinbase Tokenized Stocks. Real ownership, with dividends and voting rights attached — not synthetic exposure.",
  },
  {
    title: "Anyone can rebalance, and earn a fee for it",
    body: "When a component drifts past its threshold, the fund becomes rebalanceable by anyone. Trigger it yourself and collect the caller reward. No privileged keeper, no backend with keys.",
  },
  {
    title: "Every rebalance is announced onchain, in plain English",
    body: "Each rebalance writes a human-readable description onchain through the B20 announcement standard. Read them here, or verify them yourself on BaseScan. Nothing is summarised for you.",
  },
];

export default function Home() {
  const { funds, isLoading } = useFundList();

  return (
    <div className="mx-auto max-w-6xl px-6">
      <section className="py-20 sm:py-28">
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
          Index funds for Coinbase Tokenized Stocks.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-neutral-400">
          Every rebalance public, onchain, permissionless.
        </p>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-neutral-500">
          Deposit USDC and hold a basket of tokenized equities on Base. The operator can pause
          deposits and tune bounded parameters — and nothing else. There is no withdraw function,
          no sweep, no admin path to your assets. You can always exit in kind, even if every oracle
          is frozen.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Funds</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {funds.map((address) => (
            <FundCard key={address} address={address} />
          ))}
        </div>

        {funds.length === 0 && (
          <div className="mt-5 rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
            <p className="text-sm text-neutral-400">
              {isLoading ? "Loading funds…" : "No funds deployed yet."}
            </p>
            {!isLoading && (
              <p className="mt-2 text-xs text-neutral-600">
                Set NEXT_PUBLIC_FACTORY_ADDRESS or NEXT_PUBLIC_FUND_ADDRESSES once the contracts
                are live on Base mainnet.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="py-20">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          How it works
        </h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
              <span className="font-mono text-xs text-indigo-400">0{i + 1}</span>
              <h3 className="mt-3 font-medium text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
