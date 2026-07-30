import { useCallback, useEffect, useRef, useState } from "react";

import type { CloudSaveV2FileDetails, GameShop } from "@types";

interface UseCloudSaveV2FileDetailsOptions {
  objectId: string;
  shop: GameShop;
  enabled: boolean;
}

export const useCloudSaveV2FileDetails = ({
  objectId,
  shop,
  enabled,
}: UseCloudSaveV2FileDetailsOptions) => {
  const [details, setDetails] = useState<CloudSaveV2FileDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const gameKey = `${shop}:${objectId}`;
  const activeGameKey = useRef(gameKey);
  const enabledRef = useRef(enabled);
  const activeRequest = useRef<Promise<void> | null>(null);
  const requestGeneration = useRef(0);
  const hasQueuedRefresh = useRef(false);
  const scheduledRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);

  enabledRef.current = enabled;

  const refresh = useCallback((): Promise<void> => {
    if (!enabledRef.current) return Promise.resolve();

    const runningRequest = activeRequest.current;
    if (runningRequest) {
      hasQueuedRefresh.current = true;
      return runningRequest;
    }

    const requestedGameKey = gameKey;
    const requestedGeneration = requestGeneration.current;
    const request = (async () => {
      setIsLoading(true);
      do {
        hasQueuedRefresh.current = false;
        if (
          activeGameKey.current === requestedGameKey &&
          requestGeneration.current === requestedGeneration
        ) {
          setHasError(false);
        }

        try {
          const result = await window.electron.getCloudSaveV2FileDetails(
            objectId,
            shop
          );
          if (
            activeGameKey.current === requestedGameKey &&
            requestGeneration.current === requestedGeneration &&
            enabledRef.current
          ) {
            setDetails(result);
          }
        } catch {
          if (
            activeGameKey.current === requestedGameKey &&
            requestGeneration.current === requestedGeneration &&
            enabledRef.current
          ) {
            setHasError(true);
          }
        }
      } while (
        hasQueuedRefresh.current &&
        enabledRef.current &&
        activeGameKey.current === requestedGameKey &&
        requestGeneration.current === requestedGeneration
      );
    })().finally(() => {
      if (activeRequest.current === request) {
        activeRequest.current = null;
        if (
          activeGameKey.current === requestedGameKey &&
          requestGeneration.current === requestedGeneration
        ) {
          setIsLoading(false);
        }
      }
    });

    activeRequest.current = request;
    return request;
  }, [gameKey, objectId, shop]);

  const scheduleRefresh = useCallback(() => {
    if (scheduledRefresh.current) clearTimeout(scheduledRefresh.current);
    scheduledRefresh.current = setTimeout(() => {
      scheduledRefresh.current = null;
      void refresh();
    }, 100);
  }, [refresh]);

  useEffect(() => {
    activeGameKey.current = gameKey;
    requestGeneration.current += 1;
    activeRequest.current = null;
    hasQueuedRefresh.current = false;
    setDetails(null);
    setHasError(false);
    setIsLoading(false);
  }, [gameKey]);

  useEffect(() => {
    if (enabled) {
      void refresh();
      return;
    }

    requestGeneration.current += 1;
    activeRequest.current = null;
    hasQueuedRefresh.current = false;
    setDetails(null);
    setHasError(false);
    setIsLoading(false);
  }, [enabled, refresh]);

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
      if (scheduledRefresh.current) {
        clearTimeout(scheduledRefresh.current);
        scheduledRefresh.current = null;
      }
    };
  }, [enabled, scheduleRefresh]);

  return { details, isLoading, hasError, refresh };
};
