# Slate — Base Builder Quest submission

Everything needed for the submission form. **Nothing here has been posted anywhere.** Fields marked
`TODO` need values that only exist after the mainnet deploy.

## Project

**Name:** Slate

**One-line description:** Onchain index funds of Coinbase Tokenized Stocks where every rebalance is
public, permissionless, and announced onchain in plain English.

**Longer description:**
> Slate lets anyone deposit USDC and receive a B20 share token representing a proportional stake in
> a custodied basket of Coinbase Tokenized Stocks on Base. The fund rebalances permissionlessly —
> anyone can trigger one when weights drift past the threshold and collect a caller reward, so
> there is no keeper and no backend holding keys. Every rebalance is bracketed in a B20
> announcement carrying a human-readable reason, written onchain by the fund itself and readable on
> BaseScan. The operator can pause deposits and tune bounded parameters and nothing else: there is
> no withdraw, no sweep, and no admin path to user assets, and in-kind redemption works even when
> every oracle is frozen.

**Live URL:** TODO (Vercel)

**GitHub:** TODO (public repo URL)

**Builder Code:** TODO (register at dashboard.base.org, then set `NEXT_PUBLIC_BUILDER_CODE`)

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
