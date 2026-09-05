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
      </div>
    </footer>
  );
}
