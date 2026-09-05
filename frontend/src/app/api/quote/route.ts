import { NextResponse } from "next/server";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CHAIN_ID = "8453";

/// Server-side proxy for 0x quotes. The API key stays here and never reaches the browser.
/// We request the allowance-holder flavour specifically, so `transaction.to` is always the
/// AllowanceHolder contract the fund is configured to call.
export async function POST(request: Request) {
  const apiKey = process.env.ZEROX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ZEROX_API_KEY is not configured on the server." },
      { status: 503 }
    );
  }

  let body: { taker?: string; legs?: { token: string; sellAmount: string }[] };
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
        const url = new URL("https://api.0x.org/swap/allowance-holder/quote");
        url.searchParams.set("chainId", CHAIN_ID);
        url.searchParams.set("sellToken", USDC);
        url.searchParams.set("buyToken", leg.token);
        url.searchParams.set("sellAmount", leg.sellAmount);
        url.searchParams.set("taker", taker);

        const res = await fetch(url, {
          headers: { "0x-api-key": apiKey, "0x-version": "v2" },
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error(`0x quote failed for ${leg.token}: ${res.status} ${await res.text()}`);
        }

        const quote = (await res.json()) as {
          buyAmount: string;
          transaction: { to: string; data: string };
        };

        return {
          token: leg.token,
          sellAmount: leg.sellAmount,
          buyAmount: quote.buyAmount,
          data: quote.transaction.data,
          to: quote.transaction.to,
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
