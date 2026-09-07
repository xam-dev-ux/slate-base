import { parseAbiItem, type Address, type PublicClient } from "viem";
import { GENESIS_BLOCK } from "./config";
import { getLogsChunked } from "./getLogsChunked";

export const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 amount)"
);

const ZERO = "0x0000000000000000000000000000000000000000";

/// One checkpoint per change to a holder's position or to total supply, in chain order.
export type ShareCheckpoint = {
  blockNumber: bigint;
  logIndex: number;
  balance: bigint;
  totalSupply: bigint;
};

/// Replays the share token's Transfer log into a position history for one holder.
///
/// A holder's share of a past rebalance cannot be read from their balance today: they may have
/// deposited after it, or held far more at the time. Mints (`from == 0`) and burns (`to == 0`) also
/// move total supply, so the denominator changes independently of the holder. Replaying the log is
/// the only way to recover the fraction that actually applied at a given block.
export function replayForHolder(
  logs: readonly {
    blockNumber: bigint;
    logIndex: number;
    args: { from?: Address; to?: Address; amount?: bigint };
  }[],
  holder: Address
): ShareCheckpoint[] {
  const me = holder.toLowerCase();

  const ordered = [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1
  );

  const checkpoints: ShareCheckpoint[] = [];
  let balance = 0n;
  let totalSupply = 0n;

  for (const log of ordered) {
    const from = (log.args.from ?? ZERO).toLowerCase();
    const to = (log.args.to ?? ZERO).toLowerCase();
    const amount = log.args.amount ?? 0n;

    if (from === ZERO) totalSupply += amount;
    else if (from === me) balance -= amount;

    if (to === ZERO) totalSupply -= amount;
    else if (to === me) balance += amount;

    checkpoints.push({
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      balance,
      totalSupply,
    });
  }

  return checkpoints;
}

/// The holder's fraction of supply immediately before the given log position, which is what a
/// rebalance at that position actually charged them. Returns 0 when they held nothing then.
export function fractionAt(
  checkpoints: ShareCheckpoint[],
  blockNumber: bigint,
  logIndex: number
): number {
  let latest: ShareCheckpoint | undefined;

  for (const c of checkpoints) {
    const isBefore =
      c.blockNumber < blockNumber ||
      (c.blockNumber === blockNumber && c.logIndex < logIndex);
    if (!isBefore) break;
    latest = c;
  }

  if (!latest || latest.totalSupply === 0n || latest.balance === 0n) return 0;
  return Number(latest.balance) / Number(latest.totalSupply);
}

export async function fetchShareTransfers(client: PublicClient, share: Address) {
  return (await getLogsChunked(client, {
    address: share,
    event: TRANSFER_EVENT,
    fromBlock: GENESIS_BLOCK,
  })) as Awaited<ReturnType<typeof client.getLogs<typeof TRANSFER_EVENT>>>;
}
