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

/// Requests one allowance-holder quote per component. The API key is never exposed to the browser
/// — this goes through our own route handler, which holds it server-side.
export async function fetchSwapLegs(params: {
  fund: Address;
  components: { token: Address; sellAmount: bigint }[];
}): Promise<SwapLeg[]> {
  const active = params.components.filter((c) => c.sellAmount > 0n);
  if (active.length === 0) return [];

  const res = await fetch("/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taker: params.fund,
      legs: active.map((c) => ({ token: c.token, sellAmount: c.sellAmount.toString() })),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || "Quote request failed");
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
