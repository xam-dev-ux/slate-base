# Slate — Base Builder Quest submission

Everything needed for the submission form. **Nothing here has been posted anywhere.** Fields marked
`TODO` need values that only exist after the mainnet deploy.

## Project

**Name:** Slate

**One-line description:** Index funds of Coinbase Tokenized Stocks on Base — deposit USDC, hold a
freely transferable B20 share token, and read every rebalance in plain English onchain.

**Longer description:**
> Slate lets anyone deposit USDC and receive a B20 share token representing a proportional stake in
> a custodied basket of Coinbase Tokenized Stocks on Base. The share is itself a B20 Asset minted
> through Base's factory precompile, with its transfer policies deliberately left open, so a
> position is an ordinary transferable token: tradeable, sendable, and composable with the rest of
> DeFi rather than locked inside the app that issued it.
>
> The fund rebalances permissionlessly — anyone can trigger one when weights drift past the
> threshold and collect a caller reward, so there is no keeper and no backend holding keys. Every
> rebalance is bracketed in a B20 announcement carrying a human-readable reason, written onchain by
> the fund itself and readable on BaseScan. The index rule the fund follows is published as
> metadata on the share token at creation, so the strategy is onchain too, not just the trades.
>
> The operator can pause deposits and tune bounded parameters and nothing else: there is no
> withdraw, no sweep, and no admin path to user assets. In-kind redemption needs neither router nor
> oracle and works even when every feed is frozen.

**Live URL:** TODO (Vercel)

**GitHub:** TODO (public repo URL)

**Builder Code:** TODO (register at dashboard.base.org, then set `NEXT_PUBLIC_BUILDER_CODE`)

## What this builds on B20

Slate does not merely hold tokenized stocks — the share token itself is a B20 Asset, and the
standard's primitives carry the product's core claims.

| B20 surface | How Slate uses it |
|---|---|
| Factory precompile `createB20` | The share token is minted as an Asset variant at deployment, from inside the fund's constructor. The fund is its own issuer. |
| `announce()` | Every rebalance is bracketed in an announcement whose `description` is the plain-English reason, generated onchain from the measured drift. This is the transparency claim, and it is the primitive's intended use. |
| `extraMetadata` | The index rule, the rebalance policy and the exact scope of operator powers are published on the token at creation, readable by anyone. |
| Transfer policies | Deliberately left unset, i.e. always-allow. Shares are ordinary transferable tokens. No account holds `PAUSE_ROLE` and the fund exposes no path to grant it, so share transfers can never be frozen — not by the operator, not by anyone. |
| Roles | `MINT`, `BURN`, `OPERATOR` and `METADATA` are held by the fund contract alone. No human key can mint or burn shares. |
| `scaledBalanceOf()` | Surfaced in the UI as a "Shares owned" column, so holders see the real share count the multiplier represents — while NAV deliberately ignores it, because the Chainlink feed already prices it in. |

The underlying components are the tokenized stocks themselves, custodied directly: real ownership
with dividends and voting rights, not synthetic exposure. Their transfer scopes carry a live policy
(ID 5) which the fork tests prove behaves as a blocklist — that a contract can custody these assets
at all is verified onchain, not assumed.

## The app

Four routes, reading everything from chain — there is no backend, no database and no indexer. Every
number shown is a live contract call or a log the visitor can re-read themselves.

**`/` — Funds.** Cards per fund: composition with target weights, TVL, rebalance count, and a badge
when deposits are paused. A market-session indicator in the header tracks whether US sessions are
open, because that governs whether the oracles are moving.

**`/funds/[address]` — Fund detail.** The centre of the product:

- **Composition table** — target vs current weight, a drift bar against the threshold, tokens held,
  and a *Shares owned* column from `scaledBalanceOf()` with the explanation that 1 token ≠ 1 share,
  since Coinbase reflects dividends and splits by raising the multiplier.
- **Rebalance history** — every rebalance the fund has performed, quoting **verbatim** the
  description it wrote onchain, with NAV before and after, the cost, the address that triggered it,
  and the viewer's own attributed share of that cost when they hold. Each row links to the
  transaction so the reader can verify the same log rather than trusting the table.
- **Rebalance status** — whether one is possible right now and why, current max drift, the
  threshold, next eligible time, the reward on offer, and a *Trigger rebalance* button enabled for
  anyone, not just the operator.
- **Oracle health** — per-feed freshness with age, since feeds are 24/5 and publish on deviation.
- **Operator powers** — the operator address, the deposit caps, the drift threshold, and the scope
  of what that role can and cannot do, read from the token's own metadata.
- **Redeem in kind** — always available, including while deposits are paused and every feed is
  stale.

**`/invest/[address]` — Deposit.** Amount entry against the live wallet cap, a preview of shares
received at the current NAV per share, the per-component split of the deposit, then approve and
deposit. Swap routes come from a 0x quote fetched through a server-side proxy so the API key never
reaches the browser.

**`/portfolio`** — Positions across every fund: shares held, current value, USDC deposited, and P&L.

Throughout, the UI gates on the contract's own `feedsHealthy()` rather than on a clock: when the
oracles are behind it explains that pricing is paused, and points at in-kind redemption as the exit
that needs no oracle at all. The legal disclaimer appears on every page.

Not built: a historical NAV chart, and a per-rebalance personal timeline on the portfolio page
(attributed cost is shown on the fund page instead).

## Contracts

All on Base mainnet (chain 8453). Fill in after deployment.

| Contract | Address | BaseScan |
|---|---|---|
| `SlateFactory` | TODO | TODO |
| Slate Big Tech 4 (`SLATE4`) | TODO | TODO |
| └ share token | TODO | TODO |
| Slate AI Core (`SLATEAI`) | TODO | TODO |
| └ share token | TODO | TODO |

### Basket composition

**Slate Big Tech 4** — equal weight, 2500 bps each: NVDAc, AAPLc, METAc, GOOGLc.

**Slate AI Core** — NVDAc 4000, GOOGLc 3000, METAc 3000.

Composition follows from a liquidity survey run on 2026-09-05: only those four of the 13 deployed
Coinbase Tokenized Stocks clear a sub-1% price impact at 1000 USDC. COINc, CRCLc and INTCc have no
pool anywhere on Base.

### Demonstration transactions

| What | Tx | Notes |
|---|---|---|
| Factory deploy | TODO | |
| Fund deploys | TODO | |
| Real deposit (second wallet) | TODO | |
| Real rebalance | TODO | Record how drift was achieved |
| `announce()` on that rebalance | TODO | The description visible on BaseScan |

## Demo video script (~2 min)

1. **The problem (15s).** Index products ask you to trust that the manager rebalanced the way they
   said. Show a fund detail page. "Every rebalance this fund has ever made is right here, in the
   fund's own words, written onchain."
2. **Composition (20s).** Walk the composition table. Point at the "Shares owned" column: 1 token
   is not 1 share — Coinbase reflects dividends and splits by raising a multiplier, so the real
   share count grows while the balance does not. Slate reads that directly.
3. **Deposit (25s).** Deposit USDC from a second wallet. Show the per-component split and the
   preview. Approve, deposit, show the shares arrive.
4. **Permissionless rebalance (35s).** Show the rebalance status card: current drift, threshold,
   the reward on offer. Trigger it **from a wallet that is not the deployer** — this is the point.
   Show the transaction land.
5. **The receipt (20s).** The new row in the rebalance history, quoted verbatim. Follow the link to
   BaseScan and read the same `Announcement` event in the raw logs. "Nothing is summarised for you."
6. **The trust property (15s).** Show the operator-powers panel. There is no withdraw function on
   this contract. Show `redeemInKind` working with markets closed.

## Draft submission post

> Slate: onchain index funds of Coinbase Tokenized Stocks, live on @base.
>
> Deposit USDC, hold a basket of tokenized equities. When weights drift, anyone can trigger the
> rebalance and earn the fee — no keeper, no backend with keys.
>
> Every rebalance writes its reason onchain. Read them yourself:
> [URL]

## Verification checklist

- [x] Liquidity re-measured; basket confirmed against live pools
- [x] `grep -r "private-key"` returns only "never use" notes
- [x] `.env` git-ignored; `ZEROX_API_KEY` server-side only
- [x] Unit tests green (`make test`)
- [x] Fork tests green against Base mainnet (`make test-fork`)
- [x] Security suite proves the operator cannot drain the fund
- [x] Multiplier double-count test passes
- [x] Deployment rehearsed on a mainnet fork
- [x] Market-closed state handled; `redeemInKind` verified with all feeds stale
- [x] Legal disclaimer on every page
- [x] Zero AI references anywhere
- [ ] Factory + 2 funds deployed and verified on Base mainnet
- [ ] Real deposit executed end-to-end from a second wallet
- [ ] Real rebalance triggered; `announce()` description visible on BaseScan
- [ ] Frontend deployed to Vercel
- [ ] Builder Code registered and wired
- [ ] `SUBMISSION.md` completed with final addresses

## Known limitations (stated plainly)

- No Coinbase Tokenized Stock has ever rebased; the multiplier path is tested only against mocks.
- cbXXX transfers are gated by policy ID 5. It behaves as a blocklist today — a fork test proves a
  contract can custody these tokens — but the policy admin could add addresses to it later.
- Fork tests cover NAV, custody, staleness and in-kind exit against real state, but not real swap
  execution; swap paths are covered against a mock router.
- Unaudited. Caps are deliberately small: 500 USDC per wallet, 25,000 USDC per fund.
