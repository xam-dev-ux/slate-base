# Project context

Working notes for picking this up on a different machine, or after time away. The code and
`docs/research-phase0.md` carry the facts; this file carries the decisions and the state.

## Where things stand

| Area | State |
|---|---|
| Research | Done — see `docs/research-phase0.md`; basket confirmed |
| `SlateFund` / `SlateFactory` | Written, compiling, 37 tests green |
| Unit tests | 26 + smoke, including the security and multiplier suites |
| Fork tests | 8 + 2 deploy-rehearsal, pinned to block 50878627 |
| Deploy scripts | Written, factory dry-run simulates clean (~0.000064 ETH) |
| Frontend | 4 routes + quote proxy, builds and lints clean |
| Mainnet deploy | **Not done** — blocked on the deployer keystore |
| Real deposit / rebalance demo | Not done — needs the deploy first |
| `SUBMISSION.md` | Written, addresses pending |

## Decisions worth not relitigating

**Basket is NVDAc / AAPLc / METAc / GOOGLc.** Not a "Mag7" — MSFTc, AMZNc and TSLAc are too thin,
and COINc, CRCLc and INTCc have no liquidity at all. See the survey.

**Rebalance swaps are not inside `announce()`.** They can't be; see the interface notes. The
announcement is a pure disclosure emitted in the same transaction.

**Rebalance legs are validated in three ways**, not just on price: a leg may only sell an overweight
component or buy an underweight one, may not overshoot past the target, and the post-trade max drift
must be within threshold. Slippage checking alone would let a griefer execute fair-priced trades
that leave the fund worse aligned.

**Deposit takes an explicit `sellAmounts` array** alongside the swap calldata. Without it the
contract cannot know how much USDC each leg consumes, and so cannot compute the oracle-implied
expected output that the slippage check compares against. The sum is validated against the
deposit *before* any funds move.

**NAV never reads `multiplier()` or `scaledBalanceOf()`.** Chainlink returns Total Return Values
that already include the multiplier. `scaledHoldings()` exists only for display. This is the single
most likely bug in a project like this and `test_navUnchangedByMultiplierAlone` guards it.

**Share token is 18 decimals** while components are 8 and USDC is 6. The bootstrap deposit converts
6dp → 18dp via `valueAdded * 1e12`.

## Environment

The toolchain is **not** vanilla Foundry. `base-forge` / `base-cast` / `base-anvil` come from
`github.com/base/base-anvil`, a fork that hosts Base's B20 precompiles inside forge's own EVM.
Stock `forge` cannot execute anything touching the factory precompile at
`0xB20f000000000000000000000000000000000000` — calls fail with "call to non-contract address".

```bash
curl -L https://raw.githubusercontent.com/base/base-anvil/HEAD/foundryup/install | bash
base-foundryup
```

Two things that will waste an hour if unknown:

- `foundry.toml` needs `base = true` under the active profile, or the precompiles are not injected
  even when running under `base-forge`.
- The stable `v1.1.0` build predates the scheduled `updateUIMultiplier(uint256,uint256)` setter.
  Calling it reverts with `0x628e600f`, which is confusingly the *function's own selector* rather
  than a real error. Install a recent nightly instead:
  `base-foundryup --install nightly-<sha>` (list them from the base-anvil releases API).

On Windows the binaries land outside the default PATH; on Linux the installer handles it.

## What is deliberately not done

- **Fork tests do not execute real swaps.** They cover NAV against real feeds, custody under the
  real transfer policy, staleness, share creation through the real precompile, and in-kind exit.
  Swap paths are unit-tested against `MockRouter`, including slippage rejection. Executing a real
  swap in a fork test needs either a 0x API key or hand-built Aerodrome Slipstream router calldata.
- **The multiplier path is mock-only**, because no Coinbase Tokenized Stock has ever rebased. The
  fork test asserts the unity multiplier rather than pretending otherwise.
- **No audit.** Caps are 500 USDC per wallet and 25,000 per fund for that reason.

## Remaining steps

1. Import the deployer keystore (interactive, never automated):
   `base-cast wallet import speedrun --interactive` — must yield
   `0x8F058fE6b568D97f85d517Ac441b52B95722fDDe`, or update `DEPLOYER` in the Makefile and both
   deploy scripts.
2. Fund it with ETH on Base for gas, plus USDC for the demo deposit.
3. `make deploy-factory-mainnet`, then `FACTORY_ADDRESS=0x… make deploy-funds-mainnet`.
4. Record addresses in `SUBMISSION.md` and in the frontend env.
5. Execute a real deposit from a second wallet, and a real rebalance from a third — the point of
   the demo is that the trigger is not the deployer.
6. Deploy the frontend; set `ZEROX_API_KEY` server-side only.
7. Flip the repository to public before submitting.
