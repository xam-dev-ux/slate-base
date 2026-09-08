import Link from "next/link";

export const metadata = {
  title: "Terms & Copyright — Slate",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <Link href="/" className="text-xs text-neutral-500 transition hover:text-neutral-300">
        ← Back
      </Link>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
        Terms &amp; Copyright
      </h1>
      <p className="mt-2 text-sm text-neutral-500">Last updated 2026-09-08.</p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-neutral-300">
        <section>
          <h2 className="text-base font-medium text-white">Copyright</h2>
          <p className="mt-2">
            © 2026{" "}
            <a
              href="https://github.com/xam-dev-ux/slate-base"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 underline decoration-dotted hover:text-indigo-300"
            >
              xam-dev-ux
            </a>
            . All rights reserved for the Slate name, its branding, this website&apos;s design and
            content, and the &quot;Slate&quot; product concept as a whole — except where the
            underlying smart-contract source code is separately source-available (see below).
            Source:{" "}
            <a
              href="https://github.com/xam-dev-ux/slate-base"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 underline decoration-dotted hover:text-indigo-300"
            >
              github.com/xam-dev-ux/slate-base
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-white">Source-available code, not permissive open source</h2>
          <p className="mt-2">
            The core contracts (
            <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs">SlateFund.sol</code>,{" "}
            <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs">SlateFactory.sol</code>,{" "}
            <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs">TwapOracle.sol</code>
            ) are licensed under the{" "}
            <a
              href="https://github.com/xam-dev-ux/slate-base/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 underline decoration-dotted hover:text-indigo-300"
            >
              Business Source License 1.1
            </a>
            , not MIT. You can read the code, fork it, and use it freely for testing, security
            auditing, academic research, or non-commercial evaluation. Production use is
            permitted up to a combined total value locked (TVL) of $10,000 across your fork; past
            that, or for any commercial use, a separate paid license from the licensor is
            required. The license converts automatically to MIT on 2029-09-08 — after that date,
            the restriction above lifts entirely. Tests, deploy scripts, and the ported{" "}
            <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs">TickMath</code>{" "}
            library keep their own, more permissive licenses — see each file&apos;s SPDX header in
            the repository.
          </p>
          <p className="mt-2">
            None of this extends to the Slate name, the visual design and copy of this website,
            or to launching a product that presents itself as Slate or as substantially the same
            offering under a different name — that requires the copyright holder&apos;s written
            consent regardless of TVL, separately from the code license above.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-white">Requesting a commercial license or brand consent</h2>
          <p className="mt-2">
            Open an issue or discussion on the repository linked above, or reach out through the
            contact details on that GitHub profile, describing what you&apos;d like to do —
            whether that&apos;s a commercial deployment past the TVL threshold, or use of the
            Slate name or branding.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-white">No warranty, no advice</h2>
          <p className="mt-2">
            Slate is source-available experimental software. It is not affiliated with, endorsed
            by, or operated by Coinbase, Coinbase Onchain SPV Ltd, Base, Chainlink, Aerodrome, or
            any other party mentioned on this site. Coinbase Tokenized Stocks are securities issued by
            Coinbase Onchain SPV Ltd under FSRA regulation, offered under Regulation S, and are not
            available to US persons. Slate is not a regulated fund, does not provide investment
            advice, and makes no representation about the suitability of any strategy for you.
          </p>
          <p className="mt-2">
            Deposits are subject to smart contract risk, oracle risk, liquidity risk and market
            risk. The contracts are unaudited. Use only funds you can afford to lose, and verify
            every contract address independently rather than trusting this site&apos;s word for
            it.
          </p>
        </section>
      </div>
    </div>
  );
}
