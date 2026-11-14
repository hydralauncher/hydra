import { useCallback, useEffect, useState } from "react";

import type { EmulatorSaveLocationStatus } from "@types";
import type { DiscCloudSaveEmulatorProvider } from "../../../../../shared/cloud-save-emulator-provider.js";

import type { EmulatorConfigCheckStatus } from "./emulator-config-presentation";

interface StatusEntry {
  gameKey: string;
  status: EmulatorConfigCheckStatus;
}

const loadSaveLocationStatus = (
  provider: DiscCloudSaveEmulatorProvider
): Promise<EmulatorSaveLocationStatus> => {
  switch (provider) {
    case "rpcs3":
      return window.electron.getRpcs3ConfigRootStatus();
    case "shadps4":
      return window.electron.getShadps4DataDirStatus();
  }
};

export function useEmulatorConfigStatus(
  provider: DiscCloudSaveEmulatorProvider | null,
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
    if (!provider) {
      setEntry(null);
      return;
    }

    let cancelled = false;
    setEntry({ gameKey, status: "checking" });
    void loadSaveLocationStatus(provider)
      .then(({ status }) => {
        if (!cancelled) setEntry({ gameKey, status });
      })
      .catch(() => {
        if (!cancelled) setEntry({ gameKey, status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [provider, gameKey, retryCount]);

  return {
    status: provider
      ? entry?.gameKey === gameKey
        ? entry.status
        : ("checking" as const)
      : null,
    retry,
  };
}
