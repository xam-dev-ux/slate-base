# Slate

Onchain index funds of Coinbase Tokenized Stocks on Base — deposit USDC, hold a freely
transferable B20 share token, and read every rebalance in plain English onchain.

**Live app:** [slate-base.vercel.app](https://slate-base.vercel.app)
**Basket funds (Base mainnet, chain 8453):**

| Fund | Address | BaseScan |
|---|---|---|
| Slate Big Tech 4 (`SLATE4`) | `0x8Cdec1a9618838b2A92C58D0309992E9C7C2B5F4` | [verified](https://basescan.org/address/0x8cdec1a9618838b2a92c58d0309992e9c7c2b5f4) |
| Slate AI Core (`SLATEAI`) | `0xbaFA2FD9FDb4E2877428bEe0f885Ff21a9d2a8dA` | [verified](https://basescan.org/address/0xbafa2fd9fdb4e2877428bee0f885ff21a9d2a8da) |
| `SlateFactory` | `0xa9887a02E3a3a94caF41f7A845D0f5020C5DBA01` | [verified](https://basescan.org/address/0xa9887a02e3a3a94caf41f7a845d0f5020c5dba01) — anyone can deploy their own basket through it |

**An index fund where every rebalance is public and auditable onchain, and nobody — including the
operator — can move user funds.**

## What makes this different from just swapping on Aerodrome

- **What you hold is a real, transferable token, not an app-specific balance.** Depositing four
  components mints you one B20 share token representing your slice of a basket shared with every
  other depositor. Send it, hold it, use it as collateral, or exit by simply selling it — no
  redeem step required.
- **Dividends and splits are handled correctly, not glossed over.** Coinbase reflects corporate
  actions on these tokens through a multiplier rather than changing balances. NAV prices off the
  raw balance times the Chainlink Total-Return-Value feed and never touches `multiplier()` — the
  single most likely double-count bug in a project like this, and the one thing this repo has a
  dedicated test guarding specifically.
- **Rebalancing is public, permissionless, and shared.** When the basket drifts past its
  threshold, *anyone* can trigger a rebalance and collect a caller reward — there is no keeper, no
  backend holding keys, and the operator has no special standing here. Triggering a rebalance
  moves the whole shared basket, not the caller's own position, and each holder's slice of that
  cost is computed from the stake they actually held at that block, replayed from the share
  token's own transfer log.
- **The operator cannot move funds — structurally, not by policy.** There is no `withdraw`, no
  `sweep`, no `emergencyWithdraw`, and no arbitrary-call path on the contract. `redeemInKind`
  needs no oracle and no router and works even when deposits are paused and every feed is frozen —
  it is the guarantee that a holder can always leave.
- **Pricing can survive a real multi-day oracle gap, if the operator opts in.** Aerodrome keeps
  these markets liquid 24/7 even when Chainlink hasn't published in days (the US Labor Day
  weekend this was built over is a live example — every feed sat 70+ hours stale). By default the
  fund just pauses pricing rather than trust anything else; an operator can enable a fallback that
  prices a stale component off a time-weighted average pulled directly from its own Aerodrome
  pool instead — real, and far harder to move than a spot price, but a genuinely weaker guarantee
  than a live independent oracle. The tradeoff is disclosed, not hidden: it's visible on every
  fund's "Pricing mode" panel and explained in the app's own "How it works" modal.

## Architecture

| Contract | Role |
|---|---|
| `SlateFund` | Custodies components, mints/burns shares, deposits, redemptions, permissionless rebalancing |
| `SlateFactory` | Permissionless deployment — anyone can launch their own index and operate it themselves |

The share token is a B20 Asset created through Base's factory precompile
(`0xB20f000000000000000000000000000000000000`). The fund holds `MINT`, `BURN`, `OPERATOR` and
`METADATA` roles on it, publishes its index rule as onchain metadata at creation, and uses
`announce()` to bracket each rebalance with a plain-English reason.

Swap routes are built off-chain and executed through the fund, but the contract never trusts that
calldata: it prices every leg against the component's Chainlink feed (or the TWAP fallback, if
enabled) and reverts if the result lands outside the slippage bound. That check — not the
calldata, and not which router built it — is the security boundary.

**Swaps route through Aerodrome Slipstream, not 0x.** 0x's API rejects every Coinbase Tokenized
Stock with `BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE` — a compliance restriction on their side — so
`/api/quote` and every onchain swap leg build calldata directly against the real liquidity venue.
Aerodrome runs multiple CL factory generations at once; `script/SlateAddresses.sol` documents
which SwapRouter/Quoter pair actually matches the pools this fund trades against, verified
on-chain rather than assumed from the first search result.

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

Other findings that shaped the contract:

- **Chainlink TRV feeds already include the multiplier.** NAV multiplies raw balances by the feed
  price and never touches `multiplier()` or `scaledBalanceOf()`, so a corporate action is counted
  exactly once. `scaledHoldings()` exists purely for display. There is a dedicated test for this.
- **Feeds are 24/5 and publish on deviation or heartbeat, not on a fixed schedule.** A weekend gap
  alone runs 60–70 hours; a holiday attached to one (this project shipped across US Labor Day) can
  push well past that. Staleness tolerance for NAV sits near a 72h ceiling accordingly, and the
  swap-execution price is checked against a much tighter, separately-bounded window — `totalNAV()`
  or a swap reverting on a genuinely stale feed is correct behaviour, not a bug. The TWAP fallback
  above exists because that correct behaviour is also a real availability cost.
- **The Aerodrome SwapRouter you'd find from a generic search may not match your pools.** Aerodrome
  has shipped multiple CL factory generations; an older, still-live SwapRouter is bound to a
  legacy factory that cannot resolve pools created by the current one. Confirmed by comparing
  `SwapRouter.factory()` against each pool's own `factory()` before trusting either.

## Honest limitations

- **No Coinbase Tokenized Stock has ever rebased.** Every one still reports a multiplier of
  exactly `1e18`. The multiplier path is therefore exercised only against mocks — it is not
  battle-tested against a real corporate action, and the fork tests assert the unity multiplier
  rather than pretending otherwise.
- **Transfers are policy-gated.** Every cbXXX transfer scope carries policy ID 5. It behaves as a
  blocklist today (a fork test proves an arbitrary contract can custody these tokens), but the
  policy admin can add addresses to it at any time — including, in principle, the fund. That is an
  inherent risk of tokenized securities and holders should know about it.
- **The TWAP fallback is a real security tradeoff, off by default.** A time-weighted average is
  far harder to move than a spot price, but it is still a weaker guarantee than a live independent
  oracle, and it's a new mechanism — verified against real pool state and a real Aerodrome swap
  execution during development, but with less runtime history than the Chainlink path it
  supplements.
- **Automated fork tests do not execute real swaps.** They cover NAV against real feeds (including
  the TWAP fallback), custody, staleness, share creation, and in-kind redemption against real
  mainnet state. Swap paths, including slippage rejection, are covered in unit tests against a
  mock router; real Aerodrome swap execution — both directions, and validated correctly against
  the TWAP-derived price — was verified manually against live pools during development rather than
  kept as a standing automated fork test.
- **Unaudited, with deliberately small caps** (500 USDC per wallet, 25k total per fund). The
  contracts custody real assets.

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

`foundry.toml` sets `base = true` (precompiles won't inject without it) and `via_ir = true`
(`SlateFactory` sits close enough to the EIP-170 24,576-byte limit that it needs the extra
optimization headroom).

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Populate `.env.local` with the deployed addresses above
(`NEXT_PUBLIC_FACTORY_ADDRESS`/`NEXT_PUBLIC_FUND_ADDRESSES`), and optionally a WalletConnect
project ID and a Base Builder Code.

### Deployment

Deployment uses a Foundry keystore (`speedrun`) and never a raw private key.

```bash
make deploy-factory-mainnet
FACTORY_ADDRESS=0x... make deploy-funds-mainnet
```

Both targets run `check-keystore` first and require confirmation before broadcasting to mainnet.

## Licence

The core contracts (`src/SlateFund.sol`, `src/SlateFactory.sol`,
`src/libraries/TwapOracle.sol`) are licensed under [BUSL 1.1](./LICENSE):
free to read, fork, and use for testing, auditing, and non-commercial
evaluation; commercial use or a fork whose TVL exceeds $10,000 requires a
separate commercial license from the licensor. The license converts to MIT
on 2029-09-08. Tests, scripts, and the ported `TickMath` library keep their
own, more permissive licenses — see each file's SPDX header.
