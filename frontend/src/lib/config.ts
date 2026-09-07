import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import type { Address } from "viem";

export const CHAIN = base;

/// Block where the current SlateFactory (Aerodrome swap router) was deployed on Base mainnet. No
/// SlateFund, share token, or factory-issued event can exist before this — bounding log scans here
/// instead of "earliest" keeps `eth_getLogs` within what public RPC endpoints will serve at all
/// (mainnet.base.org rejects a full-history scan outright). The remaining distance to "latest"
/// still grows past that RPC's separate 10,000-block range cap within hours, so `getLogsChunked`
/// (see `lib/getLogsChunked.ts`) paginates from this bound rather than issuing it as one call.
export const GENESIS_BLOCK = 50_984_267n;

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    // Base App's in-app browser bridges the wallet through this connector, not a plain injected
    // provider — without it, and without calling the mini-app SDK's ready() (see providers.tsx),
    // "Connect" does nothing there even though the same button works in a normal browser.
    farcasterMiniApp(),
    injected(),
    coinbaseWallet({ appName: "Slate" }),
    ...(wcProjectId ? [walletConnect({ projectId: wcProjectId })] : []),
  ],
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_RPC_URL ?? "https://mainnet.base.org"),
  },
  ssr: true,
});

export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/// Aerodrome Slipstream SwapRouter on Base — what the fund contract is configured to call for
/// every swap leg. See `script/SlateAddresses.sol` for why this one specifically, not 0x.
export const AERODROME_SWAP_ROUTER: Address = "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F";

export const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as Address | undefined;

/// Optional explicit fund list, so the app works before the factory is indexed.
export const CONFIGURED_FUNDS: Address[] = (process.env.NEXT_PUBLIC_FUND_ADDRESSES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is Address => /^0x[0-9a-fA-F]{40}$/.test(s));

/// Base Builder Code, attached to swaps as an ERC-8021 calldata suffix. Optional by design —
/// when unset, swaps still work, just without attribution.
export const BUILDER_CODE = process.env.NEXT_PUBLIC_BUILDER_CODE ?? "";

export const EXPLORER = "https://basescan.org";

export function explorerAddress(address: string) {
  return `${EXPLORER}/address/${address}`;
}

export function explorerTx(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}
