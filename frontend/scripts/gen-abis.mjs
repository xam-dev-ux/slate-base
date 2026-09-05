// Regenerates src/lib/abis.ts from the Foundry build output so the frontend can never drift
// from the deployed contracts. Run from the frontend directory: node scripts/gen-abis.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join("..", "out");

function abiOf(contract) {
  const artifact = JSON.parse(readFileSync(join(OUT, `${contract}.sol`, `${contract}.json`), "utf8"));
  return artifact.abi;
}

const slateFund = abiOf("SlateFund");
const slateFactory = abiOf("SlateFactory");

const header = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/gen-abis.mjs (after \`base-forge build\`).
`;

const body = `${header}
export const slateFundAbi = ${JSON.stringify(slateFund, null, 2)} as const;

export const slateFactoryAbi = ${JSON.stringify(slateFactory, null, 2)} as const;

/// Minimal ERC-20 surface. Coinbase Tokenized Stocks are B20 assets, but the selectors used here
/// are identical to standard ERC-20, so the same ABI covers USDC and the components alike.
export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "scaledBalanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "extraMetadata",
    stateMutability: "view",
    inputs: [{ name: "key", type: "string" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/// Emitted by the B20 share token to bracket a rebalance. The description is the human-readable
/// reason, written on-chain by the fund itself.
export const announcementEventAbi = [
  {
    type: "event",
    name: "Announcement",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "id", type: "string", indexed: false },
      { name: "description", type: "string", indexed: false },
      { name: "uri", type: "string", indexed: false },
    ],
  },
] as const;
`;

mkdirSync(join("src", "lib"), { recursive: true });
writeFileSync(join("src", "lib", "abis.ts"), body);
console.log(
  `Wrote src/lib/abis.ts (SlateFund: ${slateFund.length} entries, SlateFactory: ${slateFactory.length} entries)`
);
