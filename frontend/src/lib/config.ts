import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import type { Address } from "viem";

export const CHAIN = base;

/// Block where SlateFactory was first deployed on Base mainnet. No SlateFund, share token, or
/// factory-issued event can exist before this — bounding log scans here instead of "earliest"
/// keeps `eth_getLogs` within what public RPC endpoints will actually serve (mainnet.base.org
/// rejects a full-history scan with a 413).
export const GENESIS_BLOCK = 50_967_435n;

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
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
