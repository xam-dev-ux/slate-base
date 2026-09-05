# Phase 0 research

Everything below was measured on-chain on **2026-09-05** against Base mainnet, not taken from
launch-day announcements. Re-run the measurements before trusting them again — liquidity moves, and
these numbers are what justified the basket composition.

## Liquidity survey

Real liquidity lives on **Aerodrome Slipstream** (concentrated liquidity). The legacy volatile-AMM
`PoolFactory` at `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` *does* return non-zero pools for
several tickers, but their reserves are dust (the NVDAc pool held ~$0.004). Those are abandoned
decoys, not where trading happens.

Price impact below is a constant-product approximation seeded from real pool TVL. Slipstream pools
are concentrated, so treat these as magnitude estimates, not exact swap simulations.

| Ticker | Pool | TVL | Impact @100 | Impact @1000 | Verdict |
|---|---|---|---|---|---|
| NVDAc | `0x853F5f1B92b16714Fe6CDA67CAad0856B83C7ab9` | ~$2.60M | 0.008% | 0.077% | **Viable** |
| GOOGLc | `0xB1987CAD1682841b4b641d50E520777eC5Ab5542` | ~$1.68M | 0.012% | 0.119% | **Viable** |
| AAPLc | `0xA3b1E3f9747065e2073722Ff4c9027d3eA4994F0` | ~$1.45M | 0.014% | 0.137% | **Viable** |
| METAc | `0xEAF57753BC382E0324a1D43F72E7027705a2273E` | ~$1.08M | 0.019% | 0.185% | **Viable** |
| TSLAc | `0x469337fdcc5e8f38e2e4b670b04f57865d13a7bb` | ~$149K | 0.134% | 1.323% | Marginal |
| SNDKc | `0x5a8236f575471e7bfca2c8462a200c28f737246e` | ~$146K | 0.137% | 1.353% | Marginal |
| AMZNc | `0xd03bc8c7f2faedce2aac81bf0444aea08ea06e9b` | ~$140K | 0.142% | 1.406% | Marginal |
| MSTRc | `0x8b27f626ab668197000bc722a1012022caed10e2` | ~$129K | 0.154% | 1.522% | Marginal |
| SPCXc | `0x0bf58fe0fac935ac69595c19b12ba0d75e3f8c0e` | ~$62K | 0.322% | 3.131% | Poor |
| MSFTc | `0x7103eb3c9590d1281f7dc03b2a9ee27c39df5d54` | ~$49K | 0.407% | 3.925% | Poor |
| COINc | none | $0 | — | — | **Not tradeable** |
| CRCLc | none | $0 | — | — | **Not tradeable** |
| INTCc | none | $0 | — | — | **Not tradeable** |

COINc, CRCLc and INTCc have no pool on any indexed Base DEX. The COINc contract shows only
administrative transactions (approvals, role grants) — no transfers, no swaps.

**Consequence:** the basket uses NVDAc, AAPLc, METAc and GOOGLc. Nothing else clears a 1% impact
bar at 1000 USDC.

### A trap worth knowing about

Searching pools by *symbol* returns impersonators. There is a fake "COINc" pool whose base token is
`0xb20000000000000000000004cc2ec5943ebf6f1f` — note it mimics the real `0xb20…` vanity prefix but is
**not** the real COINc at `0xb200000000000000000000c85a31389D71F3ecfb`. Always resolve pools by
exact contract address.

## Token and feed properties

All 13 tokenized stocks are **8 decimals**, and the Chainlink TRV feeds are also **8 decimals**.
USDC is 6. That combination is what makes the NAV scaling in `SlateFund._quoteComponentToUsdc`
work out; it is derived from cached per-component decimals rather than hardcoded, but the values
were verified on-chain.

**No token has ever rebased.** Every one still reports `multiplier() == 1e18`.

### Transfer policies — the finding that decided viability

Every cbXXX transfer scope (`TRANSFER_SENDER_POLICY`, `TRANSFER_RECEIVER_POLICY`,
`TRANSFER_EXECUTOR_POLICY`, `MINT_RECEIVER_POLICY`) carries **policy ID 5**, not the always-allow
default of `0`.

If policy 5 were an allowlist, an arbitrary smart contract could never custody these tokens and the
whole product would be impossible. Querying the PolicyRegistry precompile
(`0x8453000000000000000000000000000000000002`) with `isAuthorized(5, addr)` returns `true` for every
address tested, including never-seen random ones — so it behaves as a **blocklist**, permissive by
default. `test_fork_contractCanCustodyPolicyGatedTokens` proves this empirically.

Policy 5's admin is `0xEC0F05C174e54FBf0Fe16ad930a8AFEbCe612812`, which can add addresses to the
blocklist at any time — including, in principle, a fund contract. This is a real, disclosable risk.

## Feed staleness, measured

Feeds are 24/5 and publish on deviation or heartbeat. Observed gaps at fork block 50878627
(2026-09-04 18:30 UTC, Friday post-market):

| Feed | Last update | Gap |
|---|---|---|
| METAc | | 9 min |
| NVDAc | | 26 min |
| AAPLc | | 69 min |
| GOOGLc | | **245 min** |

GOOGLc went over four hours without an update *during market hours*. A weekend gap (Friday close to
Monday pre-market) runs roughly **60–70 hours**.

This is why `feedStalenessTolerance` defaults near the 72h operator ceiling. A tighter value would
freeze the fund every weekend. The tradeoff — that the tolerance is also loose during the week — is
accepted deliberately, with `redeemInKind` as the oracle-free escape hatch.

## B20 interface notes

Confirmed against `base-std` source. Three things differ from what a reasonable reading of the docs
would suggest, and each one would have produced broken code:

1. **`announce()`'s `internalCalls` run via self-delegatecall on the token itself.** They cannot
   carry arbitrary external calls such as swap routing. The rebalance therefore executes swaps as
   ordinary fund logic and calls `announce()` separately with an empty `internalCalls` array as a
   pure disclosure, in the same transaction.
2. **`IB20.burn(uint256)` is single-argument and self-only.** There is no `burn(address, uint256)`.
   Redemption must pull shares in with `transferFrom` and then self-burn.
3. **`B20Constants.ALWAYS_ALLOW` does not exist.** The always-allow sentinel is policy ID `0`, the
   implicit default. Referencing the constant will not compile — just leave policy slots unset.

Also: `updateExtraMetadata` is gated by `METADATA_ROLE`, not `OPERATOR_ROLE`, so the fund grants
itself both at creation.

## Swap venue

**0x AllowanceHolder**, at `0x0000000000001fF3684f28c67538d4D072C22734` on Base (shared across
Cancun-hardfork chains; Mantle differs).

Quotes are requested from `https://api.0x.org/swap/allowance-holder/quote` specifically, so
`transaction.to` is always that contract — which lets the fund treat the router as a single fixed,
trusted call target and accept only the calldata as untrusted input. The API is key-gated (401
without `0x-api-key`).

## Base Builder Code

Not an HTTP header and not a 0x query parameter. It is an **ERC-8021 calldata suffix** appended to
`transaction.data` after the swap calldata:

```
<ascii code bytes><length byte><schema id 0x00><16-byte 8021 marker>
```

Indexers parse it backwards from the end of calldata. Smart wallets can pass it via
`wallet_sendCalls({capabilities: {dataSuffix}})`; EOA and server wallets append the bytes manually
before signing.

This is unrelated to 0x's own affiliate-fee system (`swapFeeRecipient` / `swapFeeBps` /
`swapFeeToken` query params). Both can be applied to the same swap, independently.
