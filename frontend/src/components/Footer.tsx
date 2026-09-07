import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-white/10 bg-black/20">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-xs leading-relaxed text-neutral-500">
          Slate is open-source experimental software. It is not affiliated with, endorsed by, or
          operated by Coinbase, Coinbase Onchain SPV Ltd, Base, Chainlink, Aerodrome, or any other
          party mentioned. Coinbase Tokenized Stocks are securities issued by Coinbase Onchain SPV
          Ltd under FSRA regulation, offered under Regulation S, and are not available to US
          persons. Slate is not a regulated fund, does not provide investment advice, and makes no
          representation about the suitability of any strategy. Deposits are subject to smart
          contract risk, oracle risk, liquidity risk and market risk. Use only funds you can afford
          to lose. Verify all contract addresses independently.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/5 pt-6 text-xs text-neutral-600">
          <span>
            © 2026{" "}
            <a
              href="https://github.com/xam-dev-ux"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-neutral-400"
            >
              xam-dev-ux
            </a>
          </span>
          <Link href="/terms" className="transition hover:text-neutral-400">
            Terms &amp; Copyright
          </Link>
          <a
            href="https://github.com/xam-dev-ux/slate-base"
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-neutral-400"
          >
            Source (MIT)
          </a>
        </div>
      </div>
    </footer>
  );
}
