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

## How these assets actually work, and what that forces

Everything below was measured on Base mainnet on 2026-09-05, not taken from documentation. Each
one changed the design.

**A dividend does not change your balance.** Coinbase applies corporate actions by raising the
token's multiplier, so a holder's raw balance is untouched while the number of real shares it
represents grows. `balanceOf` is therefore not the holding — `scaledBalanceOf` is. Slate shows both:
tokens held, and shares owned.

**The Chainlink feeds already price the multiplier in.** They publish Total Return Values, so
`balance × TRV` counts the corporate action exactly once. Multiplying by the multiplier as well —
the obvious-looking thing to do, given the token exposes it — would inflate NAV by the whole
multiplier factor. `totalNAV()` deliberately never reads `multiplier()` or `scaledBalanceOf()`, and
a dedicated test fires a multiplier change with the feed untouched and asserts NAV does not move by
a single wei.

**Every component is 8 decimals**, not 18, and so are the feeds, while USDC is 6. The fund derives
each component's decimals on-chain at construction rather than trusting a deploy script constant,
because getting this wrong silently misprices the whole basket.

**The feeds are 24/5 and publish on deviation or heartbeat.** At the pinned fork block, GOOGLc had
gone 245 minutes without an update *during market hours*, and a weekend gap runs 60–70 hours. So
the staleness tolerance sits near the 72h ceiling — a tighter value would freeze the fund every
weekend — and `totalNAV()` reverting on a stale feed is intended behaviour, not a bug. This is why
`redeemInKind` exists: an exit that touches no oracle at all.

**Transfers are policy-gated, and that nearly killed the product.** Every cbXXX transfer scope
carries policy ID 5, not the always-allow default of `0`. Had that been an allowlist, no smart
contract could ever custody these assets and a fund would be impossible. Querying the PolicyRegistry
precompile shows it authorises every address tested, including never-seen ones — blocklist
semantics. A fork test proves the fund can actually receive all four components rather than assuming
it. The policy admin can still add addresses later, which is disclosed as a risk.

**No tokenized stock has ever rebased.** Every one still reports a multiplier of exactly `1e18`, so
the multiplier path is exercised only against mocks. The fork test asserts that unity value instead
of pretending otherwise.

**Only four of the thirteen are tradeable.** Real liquidity lives on Aerodrome Slipstream, not the
legacy volatile-AMM factory, which holds decoy pools with dust reserves. COINc, CRCLc and INTCc have
no pool anywhere on Base — the COINc contract shows only role grants and approvals, never a swap.
Searching by symbol also surfaces impersonators mimicking the `0xb20…` vanity prefix, so pools must
be resolved by exact contract address.

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

### Details of the standard that a naive reading gets wrong

Each of these was found by reading `base-std` rather than assuming, and each would have shipped
broken code.

**`announce()` cannot carry the swaps.** Its `internalCalls` execute via self-`delegatecall` on the
asset itself, so they can only invoke that token's own functions — never a swap router. The
plausible-sounding design, wrapping the rebalance trades inside the announcement for atomicity, does
not compile into anything that works. Slate executes the swaps as ordinary fund logic and calls
`announce()` with an empty `internalCalls` array as a pure disclosure, in the same transaction. The
bracket is still atomic where it matters: the announcement and the trades either both happen or
neither does.

**`burn` is single-argument and self-only.** There is no `burn(address, uint256)`; `burn(uint256)`
burns the caller's own balance. Redemption therefore pulls the holder's shares in with
`transferFrom` and then self-burns, which is why redeeming requires an approval on the share token.

**`B20Constants.ALWAYS_ALLOW` does not exist.** The always-allow sentinel is policy ID `0`, the
implicit default for any unassigned slot. Code referencing that constant does not compile. Slate
simply never calls `updatePolicy`, which is what leaves shares freely transferable.

**`updateExtraMetadata` is gated by `METADATA_ROLE`,** not `OPERATOR_ROLE` as the announcement
machinery might suggest. The fund grants itself both at creation, or publishing its own index rule
would revert.

**Multiplier updates cannot be classified by event name.** The scheduled setter emits only
`UIMultiplierUpdated`; the deprecated instant one emits that *and* `MultiplierUpdated` in the same
transaction. The corporate-actions feed therefore classifies by co-occurrence within a transaction,
and flags instant overrides as bypassing the scheduling window.

**Stock Foundry cannot run any of this.** B20 tokens live at precompile addresses that only the
Base-flavoured toolchain implements; stock `forge` fails with "call to non-contract address" the
moment anything touches the factory. The test suite runs under `base-forge`, and `foundry.toml`
carries `base = true`, without which the precompiles are not injected even under that binary.

## The app

Five routes, reading everything from chain — there is no backend, no database and no indexer. Every
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
  stale. If a component's issuer has frozen its transfers, the all-or-nothing exit would revert, so
  a second path lets a holder leave by abandoning that component — forfeiting it explicitly rather
  than being trapped by it.
- **Corporate actions** — a feed watching every component for multiplier changes, the mechanism by
  which Coinbase reflects real dividends and splits. Scheduled updates are told apart from instant
  overrides by whether the deprecated event co-occurs in the same transaction, not by event name.
  It reads empty today because no tokenized stock has rebased yet, and says exactly that.

**`/invest/[address]` — Deposit.** Amount entry against the live wallet cap, a preview of shares
received at the current NAV per share, the per-component split of the deposit, then approve and
deposit. Swap routes come from a 0x quote fetched through a server-side proxy so the API key never
reaches the browser.

**`/verify/[address]` — Verify this yourself.** The exact `cast` commands to check NAV, holdings,
the multiplier-adjusted share count, the oracle price, every announcement, the published index
rule, and the role and policy assignments — each against Base mainnet, from the reader's own
machine. It closes by naming what *cannot* be verified this way: that the underlying tokenized
stocks are backed by real shares depends on the issuer and its custodian, not on any contract here.

**`/portfolio`** — Positions across every fund: shares held, current value, USDC deposited, and
P&L. Below them, a personal timeline of every rebalance that happened **while the viewer held
shares**, across all funds, with the share of each cost that was genuinely theirs. Stakes are
replayed from the share tokens' transfer logs, so a rebalance from before someone deposited is
never billed to them.

Throughout, the UI gates on the contract's own `feedsHealthy()` rather than on a clock: when the
oracles are behind it explains that pricing is paused, and points at in-kind redemption as the exit
that needs no oracle at all. The legal disclaimer appears on every page.

Not built: a historical NAV chart. NAV history is not stored onchain, so charting it means either
sparse points reconstructed from interaction events or historical `eth_call` against an archive
node — and with a fund only days old there is nothing yet worth plotting.

## The claims, and the tests that hold them up

51 tests, all green: 41 unit under `base-forge` with the live precompiles, and 10 fork tests against
real Base mainnet state pinned to block 50878627 — real tokens, real Chainlink feeds, the real B20
factory, real Aerodrome pools as token sources.

| Claim | What proves it |
|---|---|
| A corporate action is counted once, never twice | `test_navUnchangedByMultiplierAlone` fires a multiplier change with the feed untouched and asserts NAV moves zero. `test_dividendRaisesNavExactlyOnce` moves feed and multiplier together and asserts NAV rises by the feed's move alone |
| The operator cannot move user funds | `test_operatorCannotFarmTheFundThroughRebalances` maximises every parameter the operator controls and then calls the permissionless rebalance itself, asserting what it collects tracks the value traded rather than the size of the fund. `test_operatorFunctionsCannotMoveFunds` and `test_operatorCannotMintShares` cover the rest |
| Anyone can rebalance | `testFuzz_rebalanceIsPermissionless` fuzzes the caller across arbitrary addresses |
| A bad swap cannot be forced through | `test_rebalanceRevertsOnSlippageAtomically` and `test_depositRevertsOnBadSwapRate` reject execution outside the oracle-implied bound and leave state untouched |
| A rebalance must actually rebalance | `test_rebalanceRejectsWrongDirection` rejects buying an already-overweight component even at a fair price |
| Exit always works | `test_redeemInKindWorksPausedAndFullyStale` redeems with deposits paused and every feed frozen, after asserting that pricing itself reverts |
| One frozen component cannot trap holders | `test_oneFrozenComponentCannotTrapHolders` pauses a component exactly as its issuer could, shows the all-or-nothing exit now reverts, and gets the holder out through the fallback |
| Shares can never be frozen | `test_shareTransfersCanNeverBeFrozen` asserts no account holds `PAUSE_ROLE`, that pausing reverts, that policies read `0`, and that a holder can transfer |
| A depositor cannot spend others' cash | `test_depositCannotOverAllocateOthersCash` rejects swap legs summing beyond the deposit |
| Nested entry is blocked | `test_reentrancyGuardIsWhatBlocksNestedEntry` gives the hostile router its own funded, approved position so the nested redemption would genuinely succeed, then confirms only the guard stops it — verified by removing `nonReentrant` and watching the test fail |
| The in-kind exit returns the cash too | `test_inKindExitReturnsTheCashSliceToo` and `test_inKindExitReturnsCashAndComponentsTogether` |
| A duplicated component is impossible | `test_duplicateComponentIsRejectedAtConstruction` |
| Caps bound live exposure, not lifetime flow | `test_fundCapHoldsWhenSharesAreShuffled` and `test_exitingFreesCapacityToDepositAgain` |
| Orphaned assets cannot be bought cheaply | `test_depositRefusedWhileAssetsHaveNoOwner` |
| Swaps are judged against a fresh price | `test_swapsRequireAFresherPriceThanNav` |
| Burning shares for nothing is not a success | `test_exitDeliveringNothingReverts` |
| No value leaks between holders | `testFuzz_navPerShareStableAcrossDeposits` fuzzes deposit sizes and pins NAV per share |
| A contract can custody these assets | `test_fork_contractCanCustodyPolicyGatedTokens` moves all four real components into the fund under live policy 5 |
| NAV matches the real oracles | `test_fork_navMatchesRealFeedPrices` recomputes NAV independently from live feeds |

The deployment itself is rehearsed rather than attempted blind: `DeployForkTest` runs the exact
path the scripts take — same factory, same baskets, same index-rule strings — against forked
mainnet, and asserts both funds come out correctly configured.

## Contracts

All on Base mainnet (chain 8453). Fill in after deployment.

| Contract | Address | BaseScan |
|---|---|---|
| `SlateFactory` | `0xa9887a02E3a3a94caF41f7A845D0f5020C5DBA01` | [Verified](https://basescan.org/address/0xa9887a02e3a3a94caf41f7a845d0f5020c5dba01) |
| Slate Big Tech 4 (`SLATE4`) | `0x8Cdec1a9618838b2A92C58D0309992E9C7C2B5F4` | [Verified](https://basescan.org/address/0x8cdec1a9618838b2a92c58d0309992e9c7c2b5f4) |
| └ share token | `0xb20000000000000000000033721bf91fa778B8fc` | [BaseScan](https://basescan.org/address/0xb20000000000000000000033721bf91fa778b8fc) |
| Slate AI Core (`SLATEAI`) | `0xbaFA2FD9FDb4E2877428bEe0f885Ff21a9d2a8dA` | [Verified](https://basescan.org/address/0xbafa2fd9fdb4e2877428bee0f885ff21a9d2a8da) |
| └ share token | `0xb200000000000000000000B9CF698EC09aBcA418` | [BaseScan](https://basescan.org/address/0xb200000000000000000000b9cf698ec09abca418) |

Second redeploy. The first (`0xBa9b1EE4...`) used 0x's AllowanceHolder as the swap router — 0x's
API rejects every Coinbase Tokenized Stock with `BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE`, a compliance
restriction on their side — and was replaced by a deploy routing through Aerodrome Slipstream
(`0x1499101...`). This one adds an optional TWAP fallback for when Chainlink itself goes stale (off
by default; see "Pricing mode" on each fund page and `src/SlateFund.sol`'s
`twapFallbackEnabled`). All abandoned contracts held no deposits and are otherwise harmless.

### Basket composition

**Slate Big Tech 4** — equal weight, 2500 bps each: NVDAc, AAPLc, METAc, GOOGLc.

**Slate AI Core** — NVDAc 4000, GOOGLc 3000, METAc 3000.

Baskets are immutable: there is no function to add, remove or reweight a component after
deployment. That is the point — an operator who could choose what the fund buys could route it into
an asset they control, so composition is fixed at creation and the index rule published on the share
token stays true for the fund's whole life. New compositions mean new funds, which `SlateFactory`
lets anyone deploy. The tradeoff against a real ETF is deliberate: no index reconstitution, and
migrating means redeeming and re-depositing.

Composition follows from a liquidity survey run on 2026-09-05: only those four of the 13 deployed
Coinbase Tokenized Stocks clear a sub-1% price impact at 1000 USDC. COINc, CRCLc and INTCc have no
pool anywhere on Base.

### Demonstration transactions

| What | Tx | Notes |
|---|---|---|
| Factory deploy | [`0x65551ac69a072be8f877a88f315aeb40029b8c4280bb0a3234945a186259d201`](https://basescan.org/tx/0x65551ac69a072be8f877a88f315aeb40029b8c4280bb0a3234945a186259d201) | Block 51010221, paid 0.0000258 ETH |
| Fund deploys | [`0x980e11e2de2d7a048b991189f52ae1097c94bd345eefaee00bb53afe3ab20076`](https://basescan.org/tx/0x980e11e2de2d7a048b991189f52ae1097c94bd345eefaee00bb53afe3ab20076) (Big Tech 4), [`0x523d2a7b8a7926fdc8e14cab04bc3754ede0f6cfb0330cd98b6598e0c7916bde`](https://basescan.org/tx/0x523d2a7b8a7926fdc8e14cab04bc3754ede0f6cfb0330cd98b6598e0c7916bde) (AI Core) | Block 51010270, paid 0.0000481 ETH total |
| Real deposit (second wallet) | TODO | |
| Real rebalance | TODO | Record how drift was achieved |
| `announce()` on that rebalance | TODO | The description visible on BaseScan |

## Demo video script — Loom (~3:10)

**0:00–0:20 — The problem**

> "Coinbase has brought 13 tokenized stocks to Base. If you want diversified exposure today, you
> have to do several manual swaps and rebalance by hand whenever the weights drift. That doesn't
> scale, and nobody audits whether you did it right."

**0:20–0:50 — The solution, on screen**

Open the site. Show the funds. Go into Slate Big Tech 4. Walk the composition table: tickers,
target weight, current weight, drift bar.

**0:50–1:30 — A real mainnet deposit**

Connect wallet. Enter a small amount of USDC. Show the preview with the per-component split. Sign
approve + deposit. Show the position landing.

> "Notice I didn't get four tokens in my wallet. I got one: SLATE4. That token represents my slice
> of a shared basket that everyone who has deposited holds together."

This has to be a real mainnet transaction. If it's a mock, it shows.

**1:30–1:55 — Differentiator 1: the position is a real token**

Open the wallet, show the SLATE4 token in the balance.

> "What you're holding isn't a row in my database. It's a standard B20 token, fully transferable.
> You can send it to someone, trade it if anyone creates a pool, or use it as collateral. To exit
> the fund you don't need to redeem — you can just sell it."

Optional, if there's time and a second wallet: a real transfer of the token to another address,
live. It's the most convincing demonstration that it's genuinely transferable.

**1:55–2:25 — Differentiator 2: the multiplier**

Point at the "Shares owned" column.

> "This isn't your token balance. Coinbase's tokenized stocks use a multiplier to reflect dividends
> and splits without changing balances. Slate reads that multiplier and tells you how many shares
> you actually own. Most interfaces only show you the raw balance."

**2:25–2:55 — Differentiator 3: public rebalancing**

> "When someone triggers a rebalance, they're not rebalancing their own position — they're
> rebalancing the entire fund. We're all the same basket. And since everyone holds a percentage of
> it, the cost is split proportionally — the dashboard tells you exactly what yours was."

Go to the rebalance history table.

> "Anyone can trigger a rebalance — not just me, anyone — and they earn a reward for the gas. And
> every one is announced onchain with a readable description."

Open BaseScan, show the `Announcement` event with the literal text.

> "My backend didn't write this. It's on the chain. You can read it without trusting me."

**2:55–3:10 — Closing: the operator can't touch the funds**

> "There's no withdraw function for the operator. It doesn't exist. And you can always exit through
> in-kind redemption, even if the oracles are down and the router is broken. Open source, link in
> the description."

**Open filming questions** (see the development conversation for detail):

- The rebalance block (2:25–2:55) needs the fund to already hold a deposit with real drift before
  filming — a freshly deposited fund, split proportionally to target weights, doesn't produce drift
  on its own. Still to decide: wait for the market to move prices naturally, or force it with a
  deliberately unbalanced second operation.
- The closing line (2:55–3:10) mentions `redeemInKind` with "oracles down" — that can't be staged
  live against real feeds. Either film it during an actual window of stale feeds (right now, e.g.,
  because of the US Labor Day holiday), or swap it for a demo of the fork test
  (`test_redeemInKindWorksPausedAndFullyStale`) instead.

## Draft submission post

> Slate: onchain index funds of Coinbase Tokenized Stocks, live on Base.
>
> Deposit USDC, hold a basket of tokenized equities. When weights drift, anyone can trigger the
> rebalance and earn the fee — no keeper, no backend with keys.
>
> Every rebalance writes its reason onchain. Read them yourself, in the demo below 👇
>
> @buildonbase
>
> [Loom link]

## Verification checklist

- [x] Liquidity re-measured; basket confirmed against live pools
- [x] `grep -r "private-key"` returns only "never use" notes
- [x] `.env` git-ignored; `ZEROX_API_KEY` server-side only
- [x] Unit tests green: 31 under `base-forge` with live precompiles (`make test`)
- [x] Fork tests green: 10 against real mainnet state at a pinned block (`make test-fork`)
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

- **The multiplier path is mock-only.** No Coinbase Tokenized Stock has ever rebased, so the code
  that matters most on the day of a dividend has never met a real one. The fork test asserts the
  unity multiplier rather than implying coverage that does not exist.
- **Custody depends on a policy someone else controls.** cbXXX transfers are gated by policy ID 5.
  It behaves as a blocklist today, and a fork test proves the fund can hold all four components —
  but its admin could add addresses later, including this fund. If that happened to one component,
  holders could still exit via `redeemInKindSkippingBlocked`, forfeiting their claim on the frozen
  asset. That is a real loss, and the only outcome the fund can guarantee against a third party
  freezing an asset it holds.
- **Fork tests do not execute real swaps.** They cover NAV against live feeds, custody, staleness,
  share creation through the real precompile and in-kind exit. Swap paths, including slippage
  rejection, are covered against a mock router — they have not touched real Aerodrome liquidity.
- **Voting rights are held but not exercisable.** These tokens carry real voting rights; the fund
  custodies them and offers holders no mechanism to direct a vote. Nothing is claimed otherwise.
- **Cost attribution is exact.** Rebalance costs are attributed from the stake replayed at that
  block, from the share token's transfer log, rather than from what a viewer holds today.
- **A frozen component costs the holder that component.** If an issuer freezes one, the
  all-or-nothing exit reverts and the fallback lets a holder leave by abandoning it. That is a real,
  irreversible loss, and the best a contract can guarantee when a third party freezes an asset it
  holds.
- **Reviewed, not audited.** A structured review of the contracts before deployment found thirteen
  issues, five of which could have lost user funds — the in-kind exit silently kept the redeemer's
  cash, a duplicated component would have let a half-supply holder extract three quarters of it,
  and the caller reward, charged against total NAV, gave the operator a standing claim on the fund
  through the very rebalance function that is meant to be permissionless. All are fixed, each with
  a regression test, and two tests that could not fail were rewritten until removing the protection
  they cover makes them fail. That is a review, not an audit.
- **Caps are deliberately small**: 500 USDC per wallet, 25,000 USDC per fund. They bound live
  exposure rather than lifetime flow, so exiting frees capacity to return, and they cannot be
  removed — only tuned within a hard ceiling.
- **Not a regulated fund**, and the underlying is Regulation S — not available to US persons. Slate
  cannot geo-gate; Coinbase gates at acquisition.
