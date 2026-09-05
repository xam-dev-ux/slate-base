# Working agreement

Conventions for anyone — or any tooling — contributing to this repository.

Read `docs/project-context.md` and `docs/research-phase0.md` first. They carry the state of the
project, the decisions already made, and the on-chain measurements behind them. Do not re-derive
what is written there; do re-measure anything time-sensitive (liquidity, feed staleness) before
relying on it.

## Non-negotiables

**Authorship.** Never add a `Co-authored-by:` trailer or any co-author attribution. Do not credit
authoring tools of any kind in commit messages, PR titles or bodies, code comments, the README,
landing copy, demo scripts, or anything else that ships. Commit author and committer must be the
maintainer's configured `user.name` / `user.email`; never override `--author` or the
`GIT_AUTHOR_*` / `GIT_COMMITTER_*` variables.

**Signing.** All commits are signed (`git commit -S`). Never propose `--no-gpg-sign`. Before each
commit, confirm identity and trailers:
`git log -1 --format='%an <%ae> | %cn <%ce> | %(trailers)'`

**Keys.** Deployment uses the Foundry keystore named `speedrun`, always via `--account speedrun`,
never `--private-key`. No private key in environment variables, files, arguments, logs, or
comments. The keystore password is entered interactively at runtime — never hardcoded, never piped,
never automated with `expect`. `.env.example` carries `DEPLOYER_ADDRESS` only. Never request a private key, passphrase, or token
through any channel that records it.

**Foundry scripts.** Do not read `msg.sender` before broadcast; the deployer address is a hardcoded
constant.

## Load-bearing properties

These define the product. If something has to be cut, it is not one of these:

- Slippage validation on every swap, against the oracle-implied expected output
- `redeemInKind` as an unconditional exit — no router, no oracle, works while paused and stale
- The security suite proving the operator cannot drain the fund
- The multiplier double-count test
- Rebalance history displaying the verbatim on-chain descriptions
- Feed staleness handling

The operator can pause deposits and adjust bounded parameters. Any function that could move user
funds is a bug, not a feature.

## Commands

```bash
make test        # unit, no network
make test-fork   # against Base mainnet, self-pinned block
make test-all
```

Tests run under `base-forge`, not stock `forge` — see `docs/project-context.md` for why and for the
nightly-version trap.
