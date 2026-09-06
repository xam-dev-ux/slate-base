# Bootstrapping this project on a new machine

Written for picking the project up on a fresh Linux box (Ubuntu assumed; adapt paths for macOS).
Follow it top to bottom and you end with a working toolchain, a green test suite, and the ability
to sign commits and deploy.

Read `docs/project-context.md` and `docs/research-phase0.md` before changing anything — they carry
the state, the decisions, and the on-chain measurements the design rests on.

## 1. Clone

```bash
git clone https://github.com/xam-dev-ux/slate-base.git
cd slate-base
```

## 2. Toolchain

The contracts **cannot** be built or tested with stock Foundry. Base's B20 tokens live at
precompile addresses that only the Base-flavoured fork implements; stock `forge` fails with
"call to non-contract address" the moment anything touches
`0xB20f000000000000000000000000000000000000`.

```bash
curl -L https://raw.githubusercontent.com/base/base-anvil/HEAD/foundryup/install | bash
source ~/.bashrc          # or open a new shell
base-foundryup
```

That installs `base-forge`, `base-cast`, `base-anvil` and `base-chisel` alongside any stock
Foundry, without touching it.

Then fetch dependencies:

```bash
make install
```

### Verify the toolchain before trusting it

```bash
make test
```

Expect **27 passing** (26 unit + smoke), no network needed. If instead you see reverts at the
factory precompile, `base = true` is missing from the active profile in `foundry.toml`, or you are
accidentally running stock `forge`.

Then:

```bash
make test-fork
```

Expect **10 passing** against Base mainnet at a pinned block. Needs network.

### The version trap

If a test touching `updateUIMultiplier` fails with `custom error 0x628e600f`, that is not an error
code — it is the selector of `updateUIMultiplier(uint256,uint256)` itself, echoed back by a
precompile build that predates the scheduled setter. The stable `v1.1.0` build has this problem.
Install a recent nightly:

```bash
curl -s "https://api.github.com/repos/base/base-anvil/releases?per_page=10" \
  | grep '"tag_name"' | head
base-foundryup --install nightly-<sha>
```

## 3. Git identity and signing

**Every commit in this repository is GPG-signed, and must stay that way.** `git commit -S`, never
`--no-gpg-sign`. Author and committer are always `xam-dev-ux <xabiersm9@gmail.com>`, with no
co-author trailers. See `docs/working-agreement.md`.

An Ed25519 signing key already exists and is registered on the GitHub account:

| | |
|---|---|
| Key ID | `31341823C0F7D930` |
| Fingerprint | `0D7EB009312F48CA21B196E631341823C0F7D930` |
| Identity | `xam-dev-ux <xabiersm9@gmail.com>` |
| Registered | 2026-09-05, expires 2028-09-04 |

That key's private half lives only on the machine that created it. **Do not copy it here** — it was
generated without a passphrase, so moving it around means moving an unprotected signing identity
through whatever channel you use. Generate a separate key for this machine instead:

```bash
git config user.name  "xam-dev-ux"
git config user.email "xabiersm9@gmail.com"

gpg --quick-generate-key "xam-dev-ux <xabiersm9@gmail.com>" ed25519 sign 2y
gpg --list-secret-keys --keyid-format=long     # note the id after ed25519/

git config user.signingkey <NEW_KEY_ID>
git config commit.gpgsign true
git config gpg.program "$(command -v gpg)"
```

Then add the **public** half to GitHub so new commits verify:

```bash
gpg --armor --export <NEW_KEY_ID>
```

Paste at <https://github.com/settings/gpg/new>. GitHub accepts several keys per account, so commits
already signed with `31341823C0F7D930` keep their Verified badge while new ones verify under this
machine's key. Seeing two keys on the account is expected, not a mistake.

Confirm it works before relying on it:

```bash
echo test | gpg --clearsign          # should emit a signed block
git log -1 --show-signature          # should say "Good signature"
```

If a passphrase prompt fails with `Inappropriate ioctl for device`, add `export GPG_TTY=$(tty)` to
your shell profile.

## 4. Deployer keystore

Never copied between machines and never committed. Re-import from the wallet's private key:

```bash
base-cast wallet import speedrun --interactive
```

The private key is typed at a hidden prompt — never as a command argument, never into a file, never
into a chat. Verify it resolves to the expected deployer:

```bash
base-cast wallet address --account speedrun
# must print 0x8F058fE6b568D97f85d517Ac441b52B95722fDDe
```

If it differs, either you imported the wrong wallet, or you intend to use a new one — in which case
update `DEPLOYER` in `Makefile`, `script/DeployFactory.s.sol` and `script/DeployFunds.s.sol`, and
`DEPLOYER_ADDRESS` in `.env.example`.

The wallet needs ETH on **Base** for gas (0.01 is plenty) and USDC for the demo deposit.

## 5. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

`ZEROX_API_KEY` is server-side only — it must never carry a `NEXT_PUBLIC_` prefix. The
`/api/quote` route proxies 0x so the key never reaches the browser.

Note the dependency constraint: RainbowKit 2.x requires wagmi `^2.9`. Installing wagmi 3 breaks it
at runtime, and npm will happily do that if asked. The optional `@x402/*` packages are real
dependencies of the wallet SDK subtree — without them the build fails on unresolved imports.

## 6. Local instruction file

The working conventions live in `docs/working-agreement.md`. If your editor tooling reads a
root-level instruction file, symlink it rather than duplicating it, so the two never drift:

```bash
ln -s docs/working-agreement.md <the filename your tooling expects>
```

Those root-level filenames are gitignored deliberately: this repository goes public at submission,
and the shipped artefact should not advertise its tooling.

## 7. Where the work stands

See `docs/project-context.md` for the full picture. In short: contracts, tests, deploy scripts and
frontend are done and green; the mainnet deployment and the live demo transactions are not, and
they are gated on the keystore above.
