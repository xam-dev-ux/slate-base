import type { PublicClient } from "viem";

/// mainnet.base.org rejects `eth_getLogs` past a 10,000-block range (error -32614). A single fixed
/// "genesis" bound was fine right after deploy but silently breaks again a few hours later, once
/// latest - genesis exceeds that ceiling — which is exactly what happened here. Chunking keeps
/// every request inside the limit regardless of how much time has passed since GENESIS_BLOCK.
const MAX_RANGE = 9_000n;

type GetLogsParams = Parameters<PublicClient["getLogs"]>[0];

/// Returns the general log shape rather than threading the event-specific `args` type through —
/// callers that need typed `args` already cast the result, same as they did with the single
/// unchunked `client.getLogs` call this replaces.
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
    ranges.map((range) => client.getLogs({ ...params, ...range } as GetLogsParams))
  );
  return results.flat();
}
