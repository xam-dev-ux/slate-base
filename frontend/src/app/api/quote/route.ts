import { NextResponse } from "next/server";
import { createPublicClient, http, encodeFunctionData, type Address } from "viem";
import { base } from "wagmi/chains";

const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/// Aerodrome Slipstream (concentrated liquidity) on Base. 0x's API rejects every Coinbase
/// Tokenized Stock with `BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE` — a compliance restriction on their
/// side, not ours — so quotes and swap calldata are built directly against the real venue instead.
/// This SwapRouter/Quoter pair is the one whose `factory()` actually matches the pools measured in
/// `docs/research-phase0.md` — Aerodrome has multiple CL factory generations live at once (see
/// `legacyCLFactory` / `legacyCLFactory2` in their own deployment constants), and the older
/// SwapRouter at 0xBE6D8f0d...18a5 is bound to a legacy factory that does not know these pools.
/// Verified against `aerodrome-finance/slipstream` `script/constants/output/DeployCL-Base-MinUnstake.json`
/// and confirmed on-chain: `SwapRouter.factory() == PoolFactory == 0xf8f2eB49...c061Ef`.
const AERODROME_SWAP_ROUTER: Address = "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F";
const AERODROME_QUOTER: Address = "0x514c8B5f54112481E28028F1166Bd78501089259";

/// Slipstream pools use a per-pool tick spacing instead of Uniswap's fee tiers. Each of these was
/// read directly off the deployed pool (`tickSpacing()`) during the redeploy — not assumed — so a
/// component missing from this map fails loudly instead of guessing.
const TICK_SPACING: Record<string, number> = {
  ["0xb20000000000000000000078ee7ce2fE4908108C".toLowerCase()]: 10, // NVDAc
  ["0xb200000000000000000000C2e324d24d7eEcd1fb".toLowerCase()]: 10, // AAPLc
  ["0xb2000000000000000000008bC8786B856E61707C".toLowerCase()]: 10, // METAc
  ["0xb2000000000000000000002D0BA3164cc74f58B7".toLowerCase()]: 10, // GOOGLc
};

/// Router-level floor. The fund's own `maxSlippageBps` (2%, checked against the Chainlink-implied
/// value) is the real protection; this just fails fast, and cheaply, on a stale quote or a
/// sandwich attempt before that on-chain check would anyway.
const ROUTER_SLIPPAGE_BPS = 100n; // 1%

/// The deployment output labels this contract just "Quoter", but BaseScan's verified source
/// names it QuoterV2 — its `quoteExactInputSingle` takes a struct, not positional args, and the
/// struct's field order (amountIn before tickSpacing) differs from the plain Quoter/SwapRouter
/// convention (tickSpacing before recipient/deadline/amountIn). Confirmed against a real fork
/// swap before trusting this in production: quote and executed output matched to the last unit.
const quoterV2Abi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "tickSpacing", type: "int24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const swapRouterAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "tickSpacing", type: "int24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const client = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL ?? "https://mainnet.base.org"),
});

export async function POST(request: Request) {
  let body: {
    taker?: string;
    legs?: { token: string; sellAmount: string; direction?: "buy" | "sell" }[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { taker, legs } = body;
  if (!taker || !Array.isArray(legs) || legs.length === 0) {
    return NextResponse.json({ error: "taker and legs are required." }, { status: 400 });
  }

  try {
    const results = await Promise.all(
      legs.map(async (leg) => {
        const component = leg.token as Address;
        const tickSpacing = TICK_SPACING[component.toLowerCase()];
        if (tickSpacing === undefined) {
          throw new Error(`No known Aerodrome Slipstream pool for ${leg.token}.`);
        }

        // "buy" spends USDC for the component (deposits, and rebalance legs that restore an
        // underweight component); "sell" does the reverse (rebalance legs that trim an overweight
        // one). Same pool, same tick spacing — only which side is tokenIn/tokenOut flips.
        const selling = leg.direction === "sell";
        const tokenIn = selling ? component : USDC;
        const tokenOut = selling ? USDC : component;
        const amountIn = BigInt(leg.sellAmount);

        const {
          result: [amountOut],
        } = await client.simulateContract({
          address: AERODROME_QUOTER,
          abi: quoterV2Abi,
          functionName: "quoteExactInputSingle",
          args: [{ tokenIn, tokenOut, amountIn, tickSpacing, sqrtPriceLimitX96: 0n }],
        });

        const amountOutMinimum = amountOut - (amountOut * ROUTER_SLIPPAGE_BPS) / 10_000n;
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

        const data = encodeFunctionData({
          abi: swapRouterAbi,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn,
              tokenOut,
              tickSpacing,
              recipient: taker as Address,
              deadline,
              amountIn,
              amountOutMinimum,
              sqrtPriceLimitX96: 0n,
            },
          ],
        });

        return {
          token: leg.token,
          sellAmount: leg.sellAmount,
          buyAmount: amountOut.toString(),
          data,
          to: AERODROME_SWAP_ROUTER,
        };
      })
    );

    return NextResponse.json({ legs: results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Quote request failed." },
      { status: 502 }
    );
  }
}
