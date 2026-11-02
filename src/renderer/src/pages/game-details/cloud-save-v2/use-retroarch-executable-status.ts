import { useCallback, useEffect, useState } from "react";

import {
  getRetroArchExecutableStatus,
  type RetroArchExecutableStatus,
} from "./retroarch-executable-status";

interface StatusEntry {
  gameKey: string;
  status: RetroArchExecutableStatus;
}

export function useRetroArchExecutableStatus(
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
    void getRetroArchExecutableStatus(
      () => window.electron.getRetroArchConfig(),
      () => window.electron.checkRetroArchExecutable()
    ).then((status) => {
      if (!cancelled) setEntry({ gameKey, status });
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
