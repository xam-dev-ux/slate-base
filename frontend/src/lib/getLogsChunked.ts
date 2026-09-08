import { createPublicClient, http, type PublicClient } from "viem";
import { CHAIN } from "./config";

/// `eth_getLogs` range caps vary wildly by provider — mainnet.base.org allows 10,000 blocks;
/// Alchemy's free tier allows exactly 10 (confirmed directly against it: "Under the Free tier
/// plan, you can make eth_getLogs requests with up to a 10 block range"). Whatever RPC a fund
/// operator points `NEXT_PUBLIC_RPC_URL` at for the rest of the app's traffic (a paid provider,
/// picked specifically to avoid the public endpoint's aggressive eth_call rate limits) is not
/// necessarily one that can serve a multi-hundred-thousand-block log scan back to GENESIS_BLOCK
/// in a reasonable number of requests. Log scans get their own client, independent of that choice,
/// pointed at a provider whose free tier actually supports a wide range — overridable separately
/// via NEXT_PUBLIC_LOGS_RPC_URL for anyone who has one that does.
const logsClient = createPublicClient({
  chain: CHAIN,
  transport: http(process.env.NEXT_PUBLIC_LOGS_RPC_URL ?? "https://mainnet.base.org", {
    batch: { batchSize: 8, wait: 50 },
    retryCount: 3,
    retryDelay: 750,
  }),
});

const MAX_RANGE = 9_000n;

type GetLogsParams = Parameters<PublicClient["getLogs"]>[0];

/// Returns the general log shape rather than threading the event-specific `args` type through —
/// callers that need typed `args` already cast the result, same as they did with the single
/// unchunked `client.getLogs` call this replaces.
///
/// The `client` parameter is kept for its chain/type context at call sites (and as the source of
/// `latest`, since that call works fine against any provider); the actual `getLogs` calls always
/// go through the dedicated `logsClient` above, not this client's own transport.
export async function getLogsChunked(
  client: PublicClient,
  params: GetLogsParams
): Promise<Awaited<ReturnType<PublicClient["getLogs"]>>> {
  const latest = await client.getBlockNumber();
  const fromBlock = (params?.fromBlock as bigint | undefined) ?? 0n;

  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (let from = fromBlock; from <= latest; from += MAX_RANGE + 1n) {
    const to = from + MAX_RANGE > latest ? latest : from + MAX_RANGE;
    ranges.push({ fromBlock: from, toBlock: to });
  }
  if (ranges.length === 0) return [];

  const results = await Promise.all(
    ranges.map((range) => logsClient.getLogs({ ...params, ...range } as GetLogsParams))
  );
  return results.flat();
}
