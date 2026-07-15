import { useCallback, useEffect, useRef, useState } from "react";

import type { CloudSaveOverview, GameShop } from "@types";

interface UseCloudSaveOverviewOptions {
  objectId: string;
  shop: GameShop;
  enabled: boolean;
  isGameRunning: boolean;
  canAutomaticallySync: boolean;
}

interface RefreshOptions {
  allowAutomaticSync?: boolean;
}

const getActionableStateFingerprint = (overview: CloudSaveOverview) => {
  if (!overview.isAutomaticSyncEnabled) return null;

  if (overview.state !== "local-ahead" && overview.state !== "remote-ahead") {
    return null;
  }

  return `${overview.state}:${overview.activeRemoteSnapshot?.id ?? ""}`;
};

export const useCloudSaveOverview = ({
  objectId,
  shop,
  enabled,
  isGameRunning,
  canAutomaticallySync,
}: UseCloudSaveOverviewOptions) => {
  const [overview, setOverview] = useState<CloudSaveOverview | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasRefreshError, setHasRefreshError] = useState(false);
  const gameKey = `${shop}:${objectId}`;
  const activeGameKey = useRef("");
  const activeRequest = useRef<Promise<void> | null>(null);
  const hasQueuedRefresh = useRef(false);
  const queuedRefreshAllowsAutomaticSync = useRef(false);
  const scheduledRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGameRunningRef = useRef(isGameRunning);
  const canAutomaticallySyncRef = useRef(canAutomaticallySync);
  const lastTriggeredFingerprint = useRef<string | null>(null);

  isGameRunningRef.current = isGameRunning;
  canAutomaticallySyncRef.current = canAutomaticallySync;

  const refresh = useCallback(
    (options?: RefreshOptions): Promise<void> => {
      if (!enabled) return Promise.resolve();

      const allowAutomaticSync = options?.allowAutomaticSync ?? true;

      const runningRequest = activeRequest.current;
      if (runningRequest !== null) {
        hasQueuedRefresh.current = true;
        queuedRefreshAllowsAutomaticSync.current ||= allowAutomaticSync;
        return runningRequest;
      }

      const requestedGameKey = gameKey;
      const request = (async () => {
        setIsRefreshing(true);
        let currentRefreshAllowsAutomaticSync = allowAutomaticSync;
        do {
          hasQueuedRefresh.current = false;
          queuedRefreshAllowsAutomaticSync.current = false;
          if (activeGameKey.current === requestedGameKey) {
            setHasRefreshError(false);
          }

          try {
            const result = await window.electron.getCloudSaveOverview(
              objectId,
              shop
            );
            if (activeGameKey.current === requestedGameKey) {
              setOverview(result);

              const fingerprint = getActionableStateFingerprint(result);
              if (!fingerprint) {
                lastTriggeredFingerprint.current = null;
              } else if (
                currentRefreshAllowsAutomaticSync &&
                canAutomaticallySyncRef.current &&
                !isGameRunningRef.current &&
                lastTriggeredFingerprint.current !== fingerprint
              ) {
                lastTriggeredFingerprint.current = fingerprint;
                void window.electron
                  .syncCloudSaveOnStateChange(objectId, shop)
                  .then((syncResult) => {
                    if (
                      syncResult === null &&
                      activeGameKey.current === requestedGameKey &&
                      lastTriggeredFingerprint.current === fingerprint
                    ) {
                      lastTriggeredFingerprint.current = null;
                    }
                  })
                  .catch(() => {
                    if (
                      activeGameKey.current === requestedGameKey &&
                      lastTriggeredFingerprint.current === fingerprint
                    ) {
                      lastTriggeredFingerprint.current = null;
                    }
                  });
              }
            }
          } catch {
            if (activeGameKey.current === requestedGameKey) {
              setHasRefreshError(true);
            }
          }

          currentRefreshAllowsAutomaticSync =
            queuedRefreshAllowsAutomaticSync.current;
        } while (
          hasQueuedRefresh.current &&
          activeGameKey.current === requestedGameKey
        );
      })().finally(() => {
        if (activeRequest.current === request) {
          activeRequest.current = null;
          if (activeGameKey.current === requestedGameKey) {
            setIsRefreshing(false);
          }
        }
      });
      activeRequest.current = request;
      return request;
    },
    [enabled, gameKey, objectId, shop]
  );

  const scheduleRefresh = useCallback(() => {
    if (scheduledRefresh.current !== null) {
      clearTimeout(scheduledRefresh.current);
    }
    scheduledRefresh.current = setTimeout(() => {
      scheduledRefresh.current = null;
      void refresh();
    }, 100);
  }, [refresh]);

  useEffect(() => {
    activeGameKey.current = enabled ? gameKey : "";
    activeRequest.current = null;
    hasQueuedRefresh.current = false;
    queuedRefreshAllowsAutomaticSync.current = false;
    lastTriggeredFingerprint.current = null;
    setOverview(null);
    setHasRefreshError(false);
    setIsRefreshing(false);

    if (enabled) void refresh();

    return () => {
      if (scheduledRefresh.current !== null) {
        clearTimeout(scheduledRefresh.current);
        scheduledRefresh.current = null;
      }
      if (activeGameKey.current === gameKey) activeGameKey.current = "";
    };
  }, [enabled, gameKey, refresh]);

  useEffect(() => {
    if (!enabled) return;

    const handleFocus = () => scheduleRefresh();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, scheduleRefresh]);

  return { overview, isRefreshing, hasRefreshError, refresh };
};
