import { useMemo } from "react";
import { useWriteContract, type UseWriteContractParameters } from "wagmi";
import { Attribution } from "ox/erc8021";
import { BUILDER_CODE } from "./config";

/// The client-level `dataSuffix` set on `createConfig` (lib/config.ts) never actually reaches a
/// signed transaction in this wagmi version: `getConnectorClient` builds the wallet client that
/// signs and sends from the connector's own provider, from scratch, and doesn't forward the
/// config's `dataSuffix` onto it — confirmed by reading @wagmi/core's own source
/// (actions/getConnectorClient.js). The config-level setting silently did nothing; base.dev showed
/// zero attributed transactions despite real usage for exactly this reason.
///
/// viem's own `sendTransaction` (which `writeContract` calls internally) does honor a `dataSuffix`
/// passed directly in the call parameters, though — this wraps `useWriteContract` so every call
/// site gets it applied automatically, without each one having to remember to pass it.
const DATA_SUFFIX = BUILDER_CODE ? Attribution.toDataSuffix({ codes: [BUILDER_CODE] }) : undefined;

export function useAttributedWriteContract(parameters?: UseWriteContractParameters) {
  const { writeContractAsync, writeContract, ...rest } = useWriteContract(parameters);

  return {
    ...rest,
    writeContractAsync: useMemo(
      () =>
        DATA_SUFFIX
          ? ((args: Parameters<typeof writeContractAsync>[0]) =>
              writeContractAsync({ ...args, dataSuffix: DATA_SUFFIX }))
          : writeContractAsync,
      [writeContractAsync]
    ),
    writeContract: useMemo(
      () =>
        DATA_SUFFIX
          ? ((args: Parameters<typeof writeContract>[0]) =>
              writeContract({ ...args, dataSuffix: DATA_SUFFIX }))
          : writeContract,
      [writeContract]
    ),
  };
}
