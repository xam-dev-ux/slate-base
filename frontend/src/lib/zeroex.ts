import type { Address } from "viem";
import { BUILDER_CODE } from "./config";

export type SwapLeg = {
  token: Address;
  sellAmount: bigint;
  data: `0x${string}`;
  buyAmount: bigint;
};

/// Base Builder Code attribution is an ERC-8021 calldata suffix, not an API parameter: the code is
/// appended to the transaction's `data` after the swap calldata, ending in a repeating `8021`
/// marker so indexers can find it by scanning backwards. Unrelated to 0x's own affiliate-fee
/// query params — this is Base's attribution standard.
///
/// Layout: <ascii code bytes><length byte><schema id 0x00><8021 marker>
export function buildErc8021Suffix(code: string): `0x${string}` | undefined {
  if (!code) return undefined;
  const encoder = new TextEncoder();
  const codeBytes = encoder.encode(code);
  if (codeBytes.length === 0 || codeBytes.length > 255) return undefined;

  const hex = (bytes: Uint8Array) =>
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  const marker = "8021".repeat(8); // 16-byte ERC-8021 marker
  const lengthByte = codeBytes.length.toString(16).padStart(2, "0");
  const schemaId = "00";

  return `0x${hex(codeBytes)}${lengthByte}${schemaId}${marker}`;
}

/// Appends the Builder Code suffix to swap calldata. Never blocks a swap: with no code
/// configured, the calldata passes through untouched.
export function withBuilderCode(data: `0x${string}`): `0x${string}` {
  const suffix = buildErc8021Suffix(BUILDER_CODE);
  if (!suffix) return data;
  return `${data}${suffix.slice(2)}` as `0x${string}`;
}

/// Requests one Aerodrome quote per leg. Runs server-side (see app/api/quote) so the RPC calls
/// used to build swap calldata don't add to the client's own request volume.
///
/// `direction` is "buy" (spend `sellAmount` USDC for the component — deposits, and rebalance legs
/// restoring an underweight component) by default, or "sell" (spend `sellAmount` raw component
/// units for USDC — rebalance legs trimming an overweight one).
async function fetchQuoteLegs(params: {
  fund: Address;
  legs: { token: Address; sellAmount: bigint; direction?: "buy" | "sell" }[];
}): Promise<SwapLeg[]> {
  const active = params.legs.filter((c) => c.sellAmount > 0n);
  if (active.length === 0) return [];

  const res = await fetch("/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taker: params.fund,
      legs: active.map((c) => ({
        token: c.token,
        sellAmount: c.sellAmount.toString(),
        direction: c.direction ?? "buy",
      })),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // The route replies with {"error": "..."} — that "..." is often a raw viem RPC error dump
    // (a whole JSON-RPC request/response pair) when the public RPC rate-limits a quote, which
    // is uninformative and alarming shown verbatim. Surface a plain message instead and keep the
    // raw detail only for anyone reading devtools.
    let message = "Quote request failed";
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error?.toLowerCase().includes("rate limit")) {
        message = "The public RPC is rate-limited right now. Try Get quote again in a moment.";
      } else if (parsed.error) {
        message = parsed.error.split("\n")[0];
      }
    } catch {
      // body wasn't JSON — fall through to the generic message.
    }
    console.error("Quote request failed:", body);
    throw new Error(message);
  }

  const json = (await res.json()) as {
    legs: { token: Address; sellAmount: string; data: `0x${string}`; buyAmount: string }[];
  };

  return json.legs.map((l) => ({
    token: l.token,
    sellAmount: BigInt(l.sellAmount),
    buyAmount: BigInt(l.buyAmount),
    data: withBuilderCode(l.data),
  }));
}

/// Deposits: every leg spends USDC to buy a component, in the target-weight split.
export async function fetchSwapLegs(params: {
  fund: Address;
  components: { token: Address; sellAmount: bigint }[];
}): Promise<SwapLeg[]> {
  return fetchQuoteLegs({ fund: params.fund, legs: params.components });
}

/// One rebalance leg, in the exact signed units `SlateFund.rebalance`'s `amounts[]` expects:
/// negative `signedAmount` sells that many *raw component units* for USDC; positive spends that
/// much *USDC, 6dp* buying the component. The two sides are different units on purpose — that's
/// what the contract itself takes. Zero means "no leg" (the slot is still required in both arrays).
export type RebalanceLeg = { token: Address; signedAmount: bigint };

/// Builds the signed amounts + swap calldata `SlateFund.rebalance` expects, in component order.
/// Legs are quoted only for components with a non-zero amount; a zero leg gets `0x` calldata,
/// which the contract never inspects (it `continue`s past zero-amount components without calling
/// `_executeSwap` at all).
export async function fetchRebalanceLegs(params: {
  fund: Address;
  legs: RebalanceLeg[];
}): Promise<{ amounts: bigint[]; calldata: `0x${string}`[] }> {
  const quoted = await fetchQuoteLegs({
    fund: params.fund,
    legs: params.legs
      .filter((l) => l.signedAmount !== 0n)
      .map((l) => ({
        token: l.token,
        sellAmount: l.signedAmount < 0n ? -l.signedAmount : l.signedAmount,
        direction: l.signedAmount < 0n ? "sell" : "buy",
      })),
  });

  const byToken = new Map(quoted.map((l) => [l.token.toLowerCase(), l]));

  return {
    amounts: params.legs.map((l) => l.signedAmount),
    calldata: params.legs.map((l) => byToken.get(l.token.toLowerCase())?.data ?? "0x"),
  };
}
