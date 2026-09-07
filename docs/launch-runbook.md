# Launch runbook

Step-by-step to take this machine from a fresh clone to a live mainnet deployment with a working
demo. Steps 1-4 are already done on this machine (see notes under each); steps 5-9 are what is
still pending per `docs/project-context.md`.

Read `docs/project-context.md` and `docs/working-agreement.md` first if you have not — this file
does not repeat the reasoning behind any decision, only the sequence of commands.

## 1. Clone and toolchain — done on this machine

```bash
git clone https://github.com/xam-dev-ux/slate-base.git
cd slate-base
```

Toolchain already installed. If it ever needs reinstalling:

```bash
curl -L https://raw.githubusercontent.com/base/base-anvil/HEAD/foundryup/install | bash
source ~/.bashrc
base-foundryup
```

**Version trap:** the stable `v1.1.0` build fails 3 tests with `custom error 0x628e600f`
(`test_dividendRaisesNavExactlyOnce`, `test_navUnchangedByMultiplierAlone`,
`test_scaledHoldingsReflectMultiplier`) — that is the selector of `updateUIMultiplier` itself,
echoed back by a build that predates the scheduled setter. This machine runs the nightly build
`base-nightly-98e7839c65f64aee9627b69a9b98b79afaeb1fae`, which fixes it. To pick a different/newer
nightly:

```bash
curl -s "https://api.github.com/repos/base/base-anvil/releases?per_page=10" \
  | grep '"tag_name"' | head
base-foundryup --install nightly-<sha>
```

## 2. Contract dependencies and tests — done on this machine

`make install` only installs `base-std`; `forge-std` also needs installing at the repo root
(the `foundry.toml` remapping expects `lib/forge-std/`, not the copy nested inside
`lib/base-std/lib/forge-std`):

```bash
make install
base-forge install foundry-rs/forge-std --no-git
```

Then verify:

```bash
make test        # expect 41 passed (40 unit + smoke), no network
make test-fork   # expect 10 passed, against Base mainnet — needs network
```

## 3. Git identity and signing — done on this machine

```bash
git config user.name  "xam-dev-ux"
git config user.email "xabiersm9@gmail.com"
git config user.signingkey E961E8B39A0A38C0   # existing key, uid xabiersm9@gmail.com
git config commit.gpgsign true
git config gpg.program "$(command -v gpg)"
```

Confirm before relying on it:

```bash
echo test | gpg --clearsign          # should emit a signed block
git log -1 --show-signature          # should say "Good signature"
```

If GPG prompts fail with `Inappropriate ioctl for device`, add `export GPG_TTY=$(tty)` to your
shell profile.

**Per `docs/working-agreement.md`: never add a `Co-authored-by:` trailer or credit any authoring
tool in commits, PR text, comments, or anything that ships.** Commit author/committer must stay
`xam-dev-ux <xabiersm9@gmail.com>`.

## 4. Frontend build — done on this machine

```bash
cd frontend
cp .env.example .env.local
npm install
npm run lint     # should be clean
npm run build    # should compile 5 routes + /api/quote
cd ..
```

`ZEROX_API_KEY` stays server-side only (no `NEXT_PUBLIC_` prefix) — the `/api/quote` route proxies
0x so the key never reaches the browser.

## 4b. Contract size fix — done on this machine

`base-forge script ... deploy-factory-mainnet` refused to broadcast:
`Unknown0 is above the contract size limit (24734 > 24576)`. `base-forge build --sizes` confirmed
`SlateFactory` alone was 24,734 bytes runtime — 158 bytes over the EIP-170 limit that Base enforces
like any other EVM chain. This is not a warning to click through: the `CREATE` would revert on
mainnet and burn real gas for nothing.

Fix applied in `foundry.toml`:

```toml
bytecode_hash = "none"
cbor_metadata = false
via_ir = true
```

`via_ir` did the heavy lifting (cross-function optimization shrinks code size a lot more than
tuning `optimizer_runs`, which only bought back single-digit bytes of margin). Result:
`SlateFactory` 20,134 bytes (4,442 margin), `SlateFund` 15,235 bytes (9,341 margin). Re-ran
`make test` (41 passed) and `make test-fork` (10 passed) after the change — both still green.

If you ever hit this again: `base-forge build --sizes` shows every contract's runtime/initcode
size and margin against the limit before you spend any gas.

## 4c. Swap venue: 0x → Aerodrome Slipstream — done, required a redeploy

The first mainnet deploy used 0x's AllowanceHolder as `SWAP_ROUTER`. `/api/quote` worked (the key
was valid), but 0x's own API rejected every one of the four components —
`BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE`, a compliance restriction on 0x's side, not a bug here. Real
deposits would have been unable to get a swap quote at all.

`SWAP_ROUTER` is `immutable`, set once in `SlateFactory`'s constructor and inherited by every fund
it creates — so this could not be fixed without redeploying both the factory and the funds.

Fixed by routing directly against Aerodrome Slipstream instead, using addresses read from
`aerodrome-finance/slipstream`'s own `script/constants/output/*.json` and confirmed on-chain
before trusting them:

- Aerodrome has **multiple CL factory generations live at once** (`legacyCLFactory`,
  `legacyCLFactory2`, and the current one). The SwapRouter most search results point to
  (`0xBE6D8f0d...`) is bound to the legacy factory and cannot resolve the pools in
  `docs/research-phase0.md` — confirmed by comparing `SwapRouter.factory()` against each pool's own
  `factory()`. The correct pair, whose `factory()` matches exactly, is `SwapRouter`
  `0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F` and `Quoter` `0x514c8B5f54112481E28028F1166Bd78501089259`.
- That "Quoter" is actually **QuoterV2** (confirmed on BaseScan) — its `quoteExactInputSingle` takes
  a struct with a different field order than the plain `Quoter`/`SwapRouter` convention. Calling it
  with positional args reverts immediately (wrong selector) with no useful error from a public RPC;
  only a local fork trace (`base-forge test -vvvv`) showed why.
- Verified end-to-end in a fork before touching production: quoted a swap, then executed the real
  `exactInputSingle` call with dealt USDC and checked the recipient's actual token balance matched
  the quote exactly.

Then redeployed for real:

```bash
make deploy-factory-mainnet
FACTORY_ADDRESS=0x... make deploy-funds-mainnet   # use the address the previous command prints
```

`ZEROX_API_KEY` is no longer read by `/api/quote` — left in `.env`/`.env.local` in case 0x lifts
the restriction later, but it does nothing today.

## 5. Verify the deployer keystore — pending, needs your terminal

Run this yourself in an interactive shell (needs a TTY for the password prompt — cannot be
automated or run through chat):

```bash
base-cast wallet address --account speedrun
# must print 0x8F058fE6b568D97f85d517Ac441b52B95722fDDe
```

If it prints anything else, either the wrong wallet was imported, or a new one is intended — in
that case update `DEPLOYER` in `Makefile`, `script/DeployFactory.s.sol`,
`script/DeployFunds.s.sol`, and `DEPLOYER_ADDRESS` in `frontend/.env.example`.

## 6. Fund the wallet — pending

Send to the `speedrun` address on **Base mainnet**:

- ~0.01 ETH for gas
- USDC for the demo deposit (plus enough for a second wallet's deposit and a third wallet's
  rebalance trigger — see step 8)

## 7. Deploy to mainnet — pending

```bash
make deploy-factory-mainnet
# note the printed factory address, then:
FACTORY_ADDRESS=0x... make deploy-funds-mainnet
```

Both targets run `check-keystore` first, which fails loudly if the `speedrun` address doesn't
match `DEPLOYER` in the Makefile. Both have a 5-second abort window (`Ctrl-C`) before broadcasting.

## 8. Record addresses and run the real demo — pending

1. Put the factory and fund addresses into `SUBMISSION.md` and into
   `frontend/.env.local` / `frontend/.env.example` (`NEXT_PUBLIC_FACTORY_ADDRESS`, optionally
   `NEXT_PUBLIC_FUND_ADDRESSES`).
2. Execute a real deposit from a **second** wallet (not the deployer).
3. Execute a real rebalance from a **third** wallet — the point of the demo is that the trigger is
   not the deployer, since `rebalance` is deliberately permissionless.

## 9. Deploy the frontend — pending

```bash
cd frontend
npm run build
```

Deploy the build to whatever hosting you're using, with `ZEROX_API_KEY` set server-side only in
that environment (never as a `NEXT_PUBLIC_` variable, never committed).

## 10. Go public — pending, do this last

Flip the GitHub repository to public only after steps 5-9 are done. `CLAUDE.md`/`AGENTS.md` and
`.claude/` are already gitignored on purpose so the published repo doesn't advertise the tooling
used to build it.
