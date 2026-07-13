import { useCallback, useEffect, useRef, useState } from "react";

import type { CloudSaveOverview, GameShop } from "@types";

interface UseCloudSaveOverviewOptions {
  objectId: string;
  shop: GameShop;
  enabled: boolean;
}

export const useCloudSaveOverview = ({
  objectId,
  shop,
  enabled,
}: UseCloudSaveOverviewOptions) => {
  const [overview, setOverview] = useState<CloudSaveOverview | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasRefreshError, setHasRefreshError] = useState(false);
  const gameKey = `${shop}:${objectId}`;
  const activeGameKey = useRef("");
  const activeRequest = useRef<Promise<void> | null>(null);
  const hasQueuedRefresh = useRef(false);
  const scheduledRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();

    const runningRequest = activeRequest.current;
    if (runningRequest !== null) {
      hasQueuedRefresh.current = true;
      return runningRequest;
    }

    const requestedGameKey = gameKey;
    const request = (async () => {
      setIsRefreshing(true);
      do {
        hasQueuedRefresh.current = false;
        if (activeGameKey.current === requestedGameKey) {
          setHasRefreshError(false);
        }

        try {
          const result = await window.electron.getCloudSaveOverview(
            objectId,
            shop
          );
          if (activeGameKey.current === requestedGameKey) setOverview(result);
        } catch {
          if (activeGameKey.current === requestedGameKey) {
            setHasRefreshError(true);
          }
        }
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
  }, [enabled, gameKey, objectId, shop]);

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
