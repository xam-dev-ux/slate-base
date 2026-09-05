"use client";

import { useEffect, useState } from "react";

/// Wall-clock seconds, as React state rather than a `Date.now()` call during render. Reading the
/// clock while rendering is impure — it yields a different answer on the server than on the
/// client, which desyncs hydration, and changes unpredictably between re-renders. Starts at 0 and
/// fills in on mount, so callers must treat 0 as "not known yet".
export function useNowSeconds(intervalMs = 30_000): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
