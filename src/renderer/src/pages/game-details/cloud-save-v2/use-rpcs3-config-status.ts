import { useCallback, useEffect, useState } from "react";

import type { Rpcs3ConfigCheckStatus } from "./rpcs3-config-presentation";

interface StatusEntry {
  gameKey: string;
  status: Rpcs3ConfigCheckStatus;
}

export function useRpcs3ConfigStatus(
  enabled: boolean,
  gameKey: string,
  isModalVisible: boolean
) {
  const [entry, setEntry] = useState<StatusEntry | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount((count) => count + 1), []);

  useEffect(() => {
    if (isModalVisible) retry();
  }, [isModalVisible, retry]);

  useEffect(() => {
    if (!enabled) {
      setEntry(null);
      return;
    }

    let cancelled = false;
    setEntry({ gameKey, status: "checking" });
    void window.electron
      .getRpcs3ConfigRootStatus()
      .then(({ status }) => {
        if (!cancelled) setEntry({ gameKey, status });
      })
      .catch(() => {
        if (!cancelled) setEntry({ gameKey, status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, gameKey, retryCount]);

  return {
    status: enabled
      ? entry?.gameKey === gameKey
        ? entry.status
        : ("checking" as const)
      : null,
    retry,
  };
}
