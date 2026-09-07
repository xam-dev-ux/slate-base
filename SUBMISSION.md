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
| `SlateFactory` | `0x1499101084A5220a31AeE1B55eAAf0d2aF866A6F` | [Verified](https://basescan.org/address/0x1499101084a5220a31aee1b55eaaf0d2af866a6f) |
| Slate Big Tech 4 (`SLATE4`) | `0xc98010A2a990DD9B8341E237eaF1E85063f01a99` | [Verified](https://basescan.org/address/0xc98010a2a990dd9b8341e237eaf1e85063f01a99) |
| └ share token | `0xb200000000000000000000586D8Cf1beA3507a32` | [BaseScan](https://basescan.org/address/0xb200000000000000000000586d8cf1bea3507a32) |
| Slate AI Core (`SLATEAI`) | `0x38bfE2cb0B98a1E7B0046da668Edbea39288ff6B` | [Verified](https://basescan.org/address/0x38bfe2cb0b98a1e7b0046da668edbea39288ff6b) |
| └ share token | `0xB2000000000000000000001Edc48B0F3068304E2` | [BaseScan](https://basescan.org/address/0xb2000000000000000000001edc48b0f3068304e2) |

Superseded a first deploy (`0xBa9b1EE4...`, `0x4ab61530...`, `0x89Aa9Ac2...`) built with 0x's
AllowanceHolder as the swap router: 0x's API rejects every Coinbase Tokenized Stock with
`BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE`, a compliance restriction on their side. This deploy routes
swaps directly through Aerodrome Slipstream instead (see `script/SlateAddresses.sol`). The
abandoned contracts hold no deposits and are otherwise harmless.

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
| Factory deploy | [`0xc1e093c357085f1b54c40e533632bbaed83b7daf1fa85dba0c1a877f677b1ce7`](https://basescan.org/tx/0xc1e093c357085f1b54c40e533632bbaed83b7daf1fa85dba0c1a877f677b1ce7) | Block 50984267, paid 0.0000224 ETH |
| Fund deploys | [`0x4e9c7ef69d1c7e6fa613644c4b920e337d3148eb78fa1c683a97ff08b769bef7`](https://basescan.org/tx/0x4e9c7ef69d1c7e6fa613644c4b920e337d3148eb78fa1c683a97ff08b769bef7) (Big Tech 4), [`0xe2c95f35fe547b60d72121cce11935f91c5baa4d475b1c1a710d6590a0cb7f50`](https://basescan.org/tx/0xe2c95f35fe547b60d72121cce11935f91c5baa4d475b1c1a710d6590a0cb7f50) (AI Core) | Block 50984316, paid 0.0000424 ETH total |
| Real deposit (second wallet) | TODO | |
| Real rebalance | TODO | Record how drift was achieved |
| `announce()` on that rebalance | TODO | The description visible on BaseScan |

## Demo video script — Loom (~3:10)

**0:00–0:20 — El problema**

> "Coinbase ha traído 13 acciones tokenizadas a Base. Si quieres exposición diversificada hoy
> tienes que hacer varios swaps manuales y rebalancear a mano cuando los pesos se desvían. Eso no
> escala, y nadie audita si lo has hecho bien."

**0:20–0:50 — La solución en pantalla**

Abres el sitio. Muestras los fondos. Entras en Slate Big Tech 4. Enseñas la tabla de composición:
tickers, peso objetivo, peso actual, barra de deriva.

**0:50–1:30 — Depósito real en mainnet**

Conectas wallet. Metes una cantidad pequeña de USDC. Muestras la preview con el desglose por
componente. Firmas approve + deposit. Enseñas la posición apareciendo.

> "Fíjate que no me han llegado cuatro tokens al wallet. Me ha llegado uno: SLATE4. Ese token
> representa mi trozo de una cesta común que compartimos todos los que hemos depositado."

Esto tiene que ser una transacción real en mainnet. Si es un mock, se nota.

**1:30–1:55 — Diferenciador 1: la participación es un token**

Abres el wallet, muestras el token SLATE4 en el balance.

> "Lo que tienes no es un apunte en mi base de datos. Es un token B20 estándar, totalmente
> transferible. Puedes mandárselo a alguien, tradearlo si alguien crea un pool, o usarlo como
> colateral. Para salir del fondo no necesitas redimir — puedes simplemente venderlo."

Opcional si hay tiempo y un segundo wallet: transferencia real del token a otra dirección en
directo. Es la demostración más contundente de que es transferible de verdad.

**1:55–2:25 — Diferenciador 2: el multiplier**

Señalas la columna "Shares owned".

> "Esto no es tu balance de tokens. Los tokenized stocks de Coinbase usan un multiplier para
> reflejar dividendos y splits sin cambiar balances. Slate lee ese multiplier y te dice cuántas
> acciones tienes de verdad. La mayoría de interfaces solo te enseñan el balance raw."

**2:25–2:55 — Diferenciador 3: rebalanceo público**

> "Cuando alguien dispara un rebalanceo, no rebalancea su posición: rebalancea el fondo entero.
> Somos todos la misma cesta. Y como cada uno tiene un porcentaje, el coste se reparte
> proporcionalmente — el dashboard te dice exactamente cuál fue el tuyo."

Vas a la tabla de rebalanceos.

> "Cada rebalanceo lo puede disparar cualquiera — no yo, cualquiera — y se lleva una recompensa por
> el gas. Y cada uno se anuncia onchain con una descripción legible."

Abres BaseScan, enseñas el evento `Announcement` con el texto literal.

> "Esto no lo escribe mi backend. Está en la cadena. Lo puedes leer sin confiar en mí."

**2:55–3:10 — Cierre: el operador no puede tocar los fondos**

> "No hay función de retirada para el operador. No existe. Y siempre puedes salir con redención en
> especie aunque los oráculos estén caídos y el router roto. Código abierto, link en la
> descripción."

**Notas de rodaje pendientes** (ver conversación de desarrollo para el detalle):

- El bloque de rebalanceo (2:25–2:55) necesita que el fondo tenga ya un depósito con drift real
  antes de grabar — un fondo recién depositado, bien repartido según los pesos objetivo, no genera
  drift por sí solo. Falta decidir cómo se provoca: esperar a que el mercado mueva los precios, o
  forzarlo con una segunda operación deliberadamente desequilibrada.
- El cierre (2:55–3:10) menciona `redeemInKind` con "oráculos caídos" — eso no se puede forzar en
  directo con feeds reales. O se graba durante una ventana real de feeds obsoletos (ahora mismo,
  p.ej., por el festivo del Labor Day en EE.UU.), o se sustituye por una demo del fork test
  (`test_redeemInKindWorksPausedAndFullyStale`).

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
