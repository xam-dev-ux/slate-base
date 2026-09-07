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
              href="https://github.com/xam-dev-ux"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 underline decoration-dotted hover:text-indigo-300"
            >
              xam-dev-ux
            </a>
            . All rights reserved for the Slate name, its branding, this website&apos;s design and
            content, and the &quot;Slate&quot; product concept as a whole — except where the
            underlying smart-contract source code is separately open-sourced (see below). Source:{" "}
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
          <h2 className="text-base font-medium text-white">Open-source code vs. everything else</h2>
          <p className="mt-2">
            The Solidity contracts in the repository above are licensed under MIT — you can read,
            reuse, and build on that code freely, no permission needed, as the license already
            grants.
          </p>
          <p className="mt-2">
            That license covers the code. It does not extend to the Slate name, the visual design
            and copy of this website, or to launching a product that presents itself as Slate or
            as substantially the same offering under a different name. Doing any of that —
            forking this specific product, its branding, or its presentation, rather than just
            learning from or reusing the open-sourced contract code — requires the copyright
            holder&apos;s written consent first.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-white">Requesting consent</h2>
          <p className="mt-2">
            Open an issue or discussion on the repository linked above, or reach out through the
            contact details on that GitHub profile, describing what you&apos;d like to do. Reuse of
            the open-sourced contract code itself does not require this — this is only for the
            product name, branding, and presentation.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-white">No warranty, no advice</h2>
          <p className="mt-2">
            Slate is open-source experimental software. It is not affiliated with, endorsed by, or
            operated by Coinbase, Coinbase Onchain SPV Ltd, Base, Chainlink, Aerodrome, or any
            other party mentioned on this site. Coinbase Tokenized Stocks are securities issued by
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
