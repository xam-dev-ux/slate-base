# Slate

Onchain index funds of Coinbase Tokenized Stocks on Base.

Deposit USDC, receive a B20 share token representing a proportional stake in a custodied basket of
tokenized equities. The fund rebalances permissionlessly when weights drift beyond a threshold, and
every rebalance is bracketed in an onchain announcement carrying a human-readable description.

**An index fund where every rebalance is public, auditable onchain, and nobody — including the
operator — can move user funds.**

## Why it is built this way

The operator's only powers are pausing deposits and adjusting bounded parameters. There is no
`withdraw`, no `sweep`, no `emergencyWithdraw`, and no arbitrary-call path. `redeemInKind` is
user-callable only, needs no oracle and no router, and works even when deposits are paused and
every Chainlink feed is frozen — it is the guarantee that holders can always exit.

Swap routes are built off-chain (0x AllowanceHolder) and executed through the fund, but the
contract does not trust that calldata. It prices every leg against the component's Chainlink feed
and reverts if the result lands outside the slippage bound. That check — not the calldata — is the
security boundary.

## Architecture

| Contract | Role |
|---|---|
| `SlateFund` | Custodies components, mints/burns shares, deposits, redemptions, permissionless rebalancing |
| `SlateFactory` | Permissionless deployment — anyone can launch their own index and operates it themselves |

The share token is a B20 Asset created through Base's factory precompile
(`0xB20f000000000000000000000000000000000000`). The fund holds `MINT`, `BURN`, `OPERATOR` and
`METADATA` roles on it, publishes its index rule as on-chain metadata at creation, and uses
`announce()` to bracket each rebalance with a plain-English reason.

## What the research found

Liquidity was re-measured on 2026-09-05 rather than taken from launch-day figures. Of the 13
Coinbase Tokenized Stocks deployed on Base, only four clear a sub-1% price impact at 1000 USDC:

| Ticker | Pool TVL | Impact @1000 USDC |
|---|---|---|
| NVDAc | ~$2.60M | 0.08% |
| GOOGLc | ~$1.68M | 0.12% |
| AAPLc | ~$1.45M | 0.14% |
| METAc | ~$1.08M | 0.19% |

AMZNc, MSTRc, SNDKc and TSLAc sit at 1.3–1.5%; MSFTc and SPCXc at 3–4%. **COINc, CRCLc and INTCc
have no pool on any Base DEX at all.** Real liquidity lives on Aerodrome *Slipstream*, not the
legacy volatile-AMM factory, which holds only dust decoy pools.

Two other findings shaped the contract:

- **Chainlink TRV feeds already include the multiplier.** NAV multiplies raw balances by the feed
  price and never touches `multiplier()` or `scaledBalanceOf()`, so a corporate action is counted
  exactly once. `scaledHoldings()` exists purely for display. There is a dedicated test for this.
- **Feeds are 24/5 and publish on deviation or heartbeat.** At the pinned fork block, GOOGLc had
  gone 245 minutes without an update *during market hours*, and a weekend gap runs 60–70 hours.
  Staleness tolerance is set near the 72h ceiling accordingly; `totalNAV()` reverting on a stale
  feed is correct behaviour, not a bug.

## Honest limitations

- **No Coinbase Tokenized Stock has ever rebased.** Every one still reports a multiplier of exactly
  `1e18`. The multiplier path is therefore exercised only against mocks — it is not battle-tested
  against a real corporate action, and the fork tests assert the unity multiplier rather than
  pretending otherwise.
- **Transfers are policy-gated.** Every cbXXX transfer scope carries policy ID 5. It behaves as a
  blocklist today (a fork test proves an arbitrary contract can custody these tokens), but the
  policy admin can add addresses to it at any time — including, in principle, the fund. That is an
  inherent risk of tokenized securities and holders should know about it.
- **Fork tests do not execute real swaps.** They cover NAV against real feeds, custody, staleness,
  share creation and in-kind redemption. Swap paths are covered in unit tests against a mock
  router, including slippage rejection, but have not touched real Aerodrome liquidity.
- **Unaudited, with deliberately small caps** (500 USDC per wallet, 25k total). The contract
  custodies real assets.

## Development

Requires the Base-flavoured Foundry fork, which hosts Base's B20 precompiles inside forge's EVM.
Stock `forge` cannot execute anything touching the factory precompile.

```bash
curl -L https://raw.githubusercontent.com/base/base-anvil/HEAD/foundryup/install | bash
base-foundryup
make install
```

```bash
make test        # unit tests, no network
make test-fork   # against Base mainnet, pinned to a deterministic block
make test-all
```

`foundry.toml` sets `base = true`, without which the precompiles are not injected.

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

`ZEROX_API_KEY` is server-side only — the `/api/quote` route proxies 0x so the key never reaches
the browser.

### Deployment

Deployment uses a Foundry keystore and never a raw private key.

```bash
make deploy-factory-mainnet
FACTORY_ADDRESS=0x... make deploy-funds-mainnet
```

## Licence

MIT.
