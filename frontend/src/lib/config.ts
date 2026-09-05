import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import type { Address } from "viem";

export const CHAIN = base;

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

/// 0x AllowanceHolder on Base. Swap calldata is requested from the allowance-holder endpoint so
/// `transaction.to` always equals this, which is what the fund contract is configured to call.
export const ZEROX_ALLOWANCE_HOLDER: Address = "0x0000000000001fF3684f28c67538d4D072C22734";

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
