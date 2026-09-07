"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type Address } from "viem";
import { slateFundAbi, slateFactoryAbi, erc20Abi } from "./abis";
import { CONFIGURED_FUNDS, FACTORY_ADDRESS, CHAIN, GENESIS_BLOCK } from "./config";
import { getLogsChunked } from "./getLogsChunked";
import {
  fetchShareTransfers,
  replayForHolder,
  type ShareCheckpoint,
} from "./shareHistory";
import { useNowSeconds } from "./useNow";

export type Component = {
  token: Address;
  feed: Address;
  targetWeightBps: number;
  tokenDecimals: number;
  feedDecimals: number;
  symbol?: string;
  balance?: bigint;
  scaledBalance?: bigint;
  currentWeightBps?: number;
  feedUpdatedAt?: bigint;
};

/// Funds come from the factory when it is deployed, falling back to an explicit env list so the
/// app is usable the moment funds exist, before any indexing.
export function useFundList() {
  const factoryQuery = useReadContract({
    address: FACTORY_ADDRESS,
    abi: slateFactoryAbi,
    functionName: "fundsPage",
    args: [0n, 50n],
    query: { enabled: Boolean(FACTORY_ADDRESS) },
  });

  return useMemo(() => {
    const fromFactory = (factoryQuery.data as Address[] | undefined) ?? [];
    const merged = [...new Set([...fromFactory, ...CONFIGURED_FUNDS])];
    return {
      funds: merged,
      isLoading: Boolean(FACTORY_ADDRESS) && factoryQuery.isLoading,
      error: factoryQuery.error,
    };
  }, [factoryQuery.data, factoryQuery.isLoading, factoryQuery.error]);
}

/// Core fund state. NAV-dependent reads revert while any feed is stale — that is deliberate, so
/// they are surfaced as `navUnavailable` rather than treated as an error.
export function useFundSummary(fund: Address | undefined) {
  const enabled = Boolean(fund);

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: [
      { address: fund, abi: slateFundAbi, functionName: "SHARE" },
      { address: fund, abi: slateFundAbi, functionName: "totalNAV" },
      { address: fund, abi: slateFundAbi, functionName: "navPerShare" },
      { address: fund, abi: slateFundAbi, functionName: "componentsLength" },
      { address: fund, abi: slateFundAbi, functionName: "feedsHealthy" },
      { address: fund, abi: slateFundAbi, functionName: "rebalanceStatus" },
      { address: fund, abi: slateFundAbi, functionName: "depositsPaused" },
      { address: fund, abi: slateFundAbi, functionName: "maxPositionPerWallet" },
      { address: fund, abi: slateFundAbi, functionName: "maxFundValue" },
      { address: fund, abi: slateFundAbi, functionName: "totalDeposited" },
      { address: fund, abi: slateFundAbi, functionName: "rebalanceCount" },
      { address: fund, abi: slateFundAbi, functionName: "callerRewardBps" },
      { address: fund, abi: slateFundAbi, functionName: "driftThresholdBps" },
      { address: fund, abi: slateFundAbi, functionName: "OPERATOR" },
    ],
    query: { enabled },
  });

  const share = data?.[0]?.result as Address | undefined;
  const feedsHealthy = data?.[4]?.result as readonly [boolean, Address] | undefined;
  const rebalanceStatus = data?.[5]?.result as
    | readonly [boolean, string, bigint, bigint]
    | undefined;

  // totalNAV reverts on stale feeds by design.
  const navFailed = data?.[1]?.status === "failure";

  return {
    isLoading,
    // A request-level failure (RPC rate-limited, timed out, etc.) is not the same claim as "no
    // fund lives here" — the latter is a successful multicall whose per-call results are absent.
    isRpcError: Boolean(error),
    refetch,
    share,
    totalNAV: data?.[1]?.result as bigint | undefined,
    navPerShare: data?.[2]?.result as bigint | undefined,
    componentsLength: data?.[3]?.result as bigint | undefined,
    feedsHealthy: feedsHealthy?.[0],
    staleFeed: feedsHealthy?.[1],
    navUnavailable: navFailed,
    rebalancePossible: rebalanceStatus?.[0],
    rebalanceReason: rebalanceStatus?.[1],
    nextEligibleAt: rebalanceStatus?.[2],
    maxDriftBps: rebalanceStatus?.[3],
    depositsPaused: data?.[6]?.result as boolean | undefined,
    maxPositionPerWallet: data?.[7]?.result as bigint | undefined,
    maxFundValue: data?.[8]?.result as bigint | undefined,
    totalDeposited: data?.[9]?.result as bigint | undefined,
    rebalanceCount: data?.[10]?.result as bigint | undefined,
    callerRewardBps: data?.[11]?.result as number | undefined,
    driftThresholdBps: data?.[12]?.result as number | undefined,
    operator: data?.[13]?.result as Address | undefined,
  };
}

/// Share-token identity plus the index rule the fund published on-chain at creation.
export function useShareInfo(share: Address | undefined) {
  const { data } = useReadContracts({
    contracts: [
      { address: share, abi: erc20Abi, functionName: "name" },
      { address: share, abi: erc20Abi, functionName: "symbol" },
      { address: share, abi: erc20Abi, functionName: "totalSupply" },
      { address: share, abi: erc20Abi, functionName: "extraMetadata", args: ["index_rule"] },
      { address: share, abi: erc20Abi, functionName: "extraMetadata", args: ["operator_powers"] },
    ],
    query: { enabled: Boolean(share) },
  });

  return {
    name: data?.[0]?.result as string | undefined,
    symbol: data?.[1]?.result as string | undefined,
    totalSupply: data?.[2]?.result as bigint | undefined,
    indexRule: data?.[3]?.result as string | undefined,
    operatorPowers: data?.[4]?.result as string | undefined,
  };
}

export function useComponents(fund: Address | undefined, count: number | undefined) {
  const indices = useMemo(
    () => (count ? Array.from({ length: count }, (_, i) => BigInt(i)) : []),
    [count]
  );

  const { data: rawComponents } = useReadContracts({
    contracts: indices.map((i) => ({
      address: fund,
      abi: slateFundAbi,
      functionName: "components" as const,
      args: [i] as const,
    })),
    query: { enabled: Boolean(fund) && indices.length > 0 },
  });

  const parsed = useMemo(() => {
    if (!rawComponents) return [];
    return rawComponents
      .map((r) => r.result as readonly [Address, Address, number, number, number] | undefined)
      .filter(Boolean)
      .map((c) => ({
        token: c![0],
        feed: c![1],
        targetWeightBps: Number(c![2]),
        tokenDecimals: Number(c![3]),
        feedDecimals: Number(c![4]),
      }));
  }, [rawComponents]);

  // Per-component live data: symbol, custodied balance, and the multiplier-applied share count.
  const { data: enrich } = useReadContracts({
    contracts: parsed.flatMap((c) => [
      { address: c.token, abi: erc20Abi, functionName: "symbol" as const },
      {
        address: c.token,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [fund!] as const,
      },
      {
        address: c.token,
        abi: erc20Abi,
        functionName: "scaledBalanceOf" as const,
        args: [fund!] as const,
      },
    ]),
    query: { enabled: Boolean(fund) && parsed.length > 0 },
  });

  const { data: weights } = useReadContract({
    address: fund,
    abi: slateFundAbi,
    functionName: "currentWeights",
    query: { enabled: Boolean(fund) },
  });

  return useMemo<Component[]>(() => {
    return parsed.map((c, i) => ({
      ...c,
      symbol: enrich?.[i * 3]?.result as string | undefined,
      balance: enrich?.[i * 3 + 1]?.result as bigint | undefined,
      scaledBalance: enrich?.[i * 3 + 2]?.result as bigint | undefined,
      currentWeightBps: (weights as readonly number[] | undefined)?.[i],
    }));
  }, [parsed, enrich, weights]);
}

const REBALANCED_EVENT = parseAbiItem(
  "event Rebalanced(uint256 indexed rebalanceId, address indexed caller, string reason, uint256 navBefore, uint256 navAfter, uint256 callerReward)"
);

const ANNOUNCEMENT_EVENT = parseAbiItem(
  "event Announcement(address indexed caller, string id, string description, string uri)"
);

export type RebalanceRecord = {
  rebalanceId: bigint;
  caller: Address;
  reason: string;
  navBefore: bigint;
  navAfter: bigint;
  callerReward: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  announcementId?: string;
};

/// Replays the share token's transfer log so a holder's stake at any past block can be recovered.
export function useShareHistory(share: Address | undefined, holder: Address | undefined) {
  const client = usePublicClient({ chainId: CHAIN.id });

  return useQuery({
    queryKey: ["share-history", share, holder],
    enabled: Boolean(client && share && holder),
    staleTime: 60_000,
    queryFn: async (): Promise<ShareCheckpoint[]> => {
      if (!client || !share || !holder) return [];
      const logs = await fetchShareTransfers(client, share);
      return replayForHolder(logs, holder);
    },
  });
}

/// The centrepiece: every rebalance this fund has performed, with the description it wrote
/// on-chain. Read straight from logs so anyone can verify the same data independently.
export function useRebalanceHistory(fund: Address | undefined, share: Address | undefined) {
  const client = usePublicClient({ chainId: CHAIN.id });

  return useQuery({
    queryKey: ["rebalance-history", fund, share],
    enabled: Boolean(client && fund),
    staleTime: 60_000,
    queryFn: async (): Promise<RebalanceRecord[]> => {
      if (!client || !fund) return [];

      const logs = (await getLogsChunked(client, {
        address: fund,
        event: REBALANCED_EVENT,
        fromBlock: GENESIS_BLOCK,
      })) as Awaited<ReturnType<typeof client.getLogs<typeof REBALANCED_EVENT>>>;

      // Pair each rebalance with the announcement emitted in the same transaction.
      const announcements = new Map<string, string>();
      if (share) {
        try {
          const annLogs = (await getLogsChunked(client, {
            address: share,
            event: ANNOUNCEMENT_EVENT,
            fromBlock: GENESIS_BLOCK,
          })) as Awaited<ReturnType<typeof client.getLogs<typeof ANNOUNCEMENT_EVENT>>>;
          for (const log of annLogs) {
            if (log.args.id) announcements.set(log.transactionHash, log.args.id);
          }
        } catch {
          // Announcement pairing is a nicety; never let it break the history table.
        }
      }

      return logs
        .map((log) => ({
          rebalanceId: log.args.rebalanceId ?? 0n,
          caller: (log.args.caller ?? "0x") as Address,
          reason: log.args.reason ?? "",
          navBefore: log.args.navBefore ?? 0n,
          navAfter: log.args.navAfter ?? 0n,
          callerReward: log.args.callerReward ?? 0n,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          announcementId: announcements.get(log.transactionHash),
        }))
        .sort((a, b) => Number(b.blockNumber - a.blockNumber));
    },
  });
}

/// Per-component feed freshness, for the health panel and the market-session banner.
export function useFeedHealth(components: Component[], stalenessTolerance?: bigint) {
  const { data } = useReadContracts({
    contracts: components.map((c) => ({
      address: c.feed,
      abi: [
        {
          type: "function",
          name: "latestRoundData",
          stateMutability: "view",
          inputs: [],
          outputs: [
            { name: "roundId", type: "uint80" },
            { name: "answer", type: "int256" },
            { name: "startedAt", type: "uint256" },
            { name: "updatedAt", type: "uint256" },
            { name: "answeredInRound", type: "uint80" },
          ],
        },
      ] as const,
      functionName: "latestRoundData" as const,
    })),
    query: { enabled: components.length > 0 },
  });

  const now = useNowSeconds();
  const tolerance = Number(stalenessTolerance ?? 72n * 3600n);

  return components.map((c, i) => {
    const result = data?.[i]?.result as
      | readonly [bigint, bigint, bigint, bigint, bigint]
      | undefined;
    const updatedAt = result ? Number(result[3]) : undefined;
    const price = result ? result[1] : undefined;
    const ageSeconds = updatedAt && now > 0 ? now - updatedAt : undefined;
    return {
      ...c,
      price,
      updatedAt,
      ageSeconds,
      isStale: ageSeconds !== undefined ? ageSeconds > tolerance : undefined,
    };
  });
}
