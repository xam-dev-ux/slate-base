"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { useEffect, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { wagmiConfig } from "@/lib/config";
import "@rainbow-me/rainbowkit/styles.css";

/// Base App (and other Farcaster mini-app hosts) keep their splash screen up — and the wallet
/// bridge inert — until the app calls ready(). Outside a mini-app host isInMiniApp() resolves
/// false and this is a no-op, so it's safe to mount unconditionally.
function MiniAppReady() {
  useEffect(() => {
    sdk.isInMiniApp().then((isMiniApp) => {
      if (isMiniApp) sdk.actions.ready();
    });
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Chainlink feeds and fund state move slowly; avoid hammering the RPC.
            staleTime: 15_000,
            refetchInterval: 30_000,
          },
        },
      })
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({ accentColor: "#6366f1", borderRadius: "medium" })}
        >
          <MiniAppReady />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
