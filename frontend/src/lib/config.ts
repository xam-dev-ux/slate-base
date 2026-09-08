import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import type { Address } from "viem";
import { Attribution } from "ox/erc8021";

export const CHAIN = base;

/// Block where the current SlateFactory (Aerodrome swap router) was deployed on Base mainnet. No
/// SlateFund, share token, or factory-issued event can exist before this — bounding log scans here
/// instead of "earliest" keeps `eth_getLogs` within what public RPC endpoints will serve at all
/// (mainnet.base.org rejects a full-history scan outright). The remaining distance to "latest"
/// still grows past that RPC's separate 10,000-block range cap within hours, so `getLogsChunked`
/// (see `lib/getLogsChunked.ts`) paginates from this bound rather than issuing it as one call.
export const GENESIS_BLOCK = 50_984_267n;

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

/// Base Builder Code, attached to every transaction as an ERC-8021 calldata suffix. Optional by
/// design — when unset, transactions still work, just without attribution. Base's indexer reads
/// the suffix off the tail of the actual signed transaction; an earlier version of this app
/// appended it to the Aerodrome swap leg's calldata instead, nested inside a `bytes[]` argument of
/// the outer `deposit`/`rebalance` call rather than at the end of the sent transaction — invisible
/// to the indexer despite real usage.
///
/// The `dataSuffix` set below on `createConfig` looks like the right fix per Base's own docs, but
/// doesn't actually reach a signed transaction in this wagmi version: the wallet client that signs
/// and sends is built fresh from the connector's own provider in `getConnectorClient`, which does
/// not forward this config value onto it (confirmed by reading @wagmi/core's source). It's left
/// set here anyway — harmless, and correct for the one path that does read it (a local/burner
/// account via `config.getClient`) — but the write path this app actually uses needs it applied
/// per call instead. See `lib/useAttributedWrite.ts`, which every write call site uses for this.
export const BUILDER_CODE = process.env.NEXT_PUBLIC_BUILDER_CODE ?? "";

/// Plain wagmi connectors (injected(), coinbaseWallet() from "wagmi/connectors", etc.) work, but
/// RainbowKit's own modal only renders its "detected wallet" list — MetaMask, Rabby, and so on —
/// for connectors built through its own `connectorsForWallets`/wallet-definition helpers. Without
/// this, `<ConnectButton>` silently falls back to its generic "What is a Wallet? / Get a Wallet"
/// empty state even with a real wallet injected and EIP-6963-announced — confirmed by mocking a
/// MetaMask-shaped provider in a test page and seeing the same fallback screen either way.
const rainbowKitConnectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      wallets: [metaMaskWallet, rabbyWallet, coinbaseWallet, rainbowWallet, walletConnectWallet],
    },
    // Catches any other injected EIP-1193/6963 wallet not in the curated list above.
    { groupName: "Other", wallets: [injectedWallet] },
  ],
  { appName: "Slate", projectId: wcProjectId }
);

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    ...rainbowKitConnectors,
    // Base App's in-app browser bridges the wallet through this connector, not a plain injected
    // provider — without it, and without calling the mini-app SDK's ready() (see providers.tsx),
    // "Connect" does nothing there even though the same button works in a normal browser.
    farcasterMiniApp(),
  ],
  transports: {
    // mainnet.base.org rate-limits aggressively (429) once a page fires more than a handful of
    // requests close together, which this app routinely does. `batch` folds JSON-RPC calls made in
    // the same tick into one HTTP request instead of one each; the wider retry spacing gives the
    // limiter time to reset instead of hammering it again a moment later.
    //
    // batchSize is capped by the endpoint itself, not just a performance knob: mainnet.base.org
    // rejects a whole batch outright ("maximum 10 calls in 1 batch", JSON-RPC error -32014) once
    // it holds more than 10 entries — and it fails every call in the batch, not just the excess
    // ones. With several hooks (share info, oracle health, corporate actions...) all reading on
    // the same page, a size of 50 let enough calls land in one tick to trip that limit, which is
    // why fund name, feed freshness, etc. would all go blank together instead of one at a time.
    [base.id]: http(process.env.NEXT_PUBLIC_RPC_URL ?? "https://mainnet.base.org", {
      batch: { batchSize: 8, wait: 50 },
      // Stacked on top of react-query's own retries, 5×1s here could compound into a minute-plus
      // wait before a query ever reaches an error state a user can act on (see the fund page's
      // log scans) — 3 is enough to ride out a transient 429 without disappearing that long.
      retryCount: 3,
      retryDelay: 750,
    }),
  },
  // Appends the Builder Code to every transaction's calldata automatically — deposit, approve,
  // rebalance, share transfer, all of it — instead of hand-crafting the suffix at each call site.
  // wagmi's CreateConfigParameters forwards viem's ClientConfig keys generically (see
  // @wagmi/core's createConfig.d.ts), so this is genuinely typed, not slipping through untyped.
  dataSuffix: BUILDER_CODE ? Attribution.toDataSuffix({ codes: [BUILDER_CODE] }) : undefined,
  ssr: true,
});

export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/// Aerodrome Slipstream SwapRouter on Base — what the fund contract is configured to call for
/// every swap leg. See `script/SlateAddresses.sol` for why this one specifically, not 0x.
export const AERODROME_SWAP_ROUTER: Address = "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F";

export const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as Address | undefined;

/// Controls whether the "Pricing mode" panel (TWAP fallback status + operator toggle) renders on
/// the fund page — the on-chain feature itself is a per-fund contract setting, not something this
/// flag can turn on or off; this only hides/shows the UI surface for it, e.g. while it's still
/// being validated in production. Defaults on.
export const SHOW_PRICING_MODE_UI = process.env.NEXT_PUBLIC_SHOW_PRICING_MODE_UI !== "false";

/// Optional explicit fund list, so the app works before the factory is indexed.
export const CONFIGURED_FUNDS: Address[] = (process.env.NEXT_PUBLIC_FUND_ADDRESSES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is Address => /^0x[0-9a-fA-F]{40}$/.test(s));

export const EXPLORER = "https://basescan.org";

export function explorerAddress(address: string) {
  return `${EXPLORER}/address/${address}`;
}

export function explorerTx(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}
