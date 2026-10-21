import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useScreenshotCollection } from "@renderer/components/screenshots";
import { useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  buildUserScreenshotsPath,
  isLocalScreenshotForGame,
  type ScreenshotWriteBus,
} from "@shared";
import type {
  GameShop,
  LocalScreenshot,
  ScreenshotSort,
  ScreenshotsResponse,
} from "@types";

import {
  loadLocalScreenshotsForGame,
  mergeMyScreenshots,
  selectPendingLocalScreenshots,
  subscribeMyScreenshotsChanged,
} from "./my-screenshots-store";

interface UseMyGameScreenshotsOptions {
  shop: GameShop;
  objectId: string;
  sort: ScreenshotSort;
  take: number;
  isEnabled: boolean;
  writeBus: ScreenshotWriteBus;
}

export function useMyGameScreenshots({
  shop,
  objectId,
  sort,
  take,
  isEnabled,
  writeBus,
}: UseMyGameScreenshotsOptions) {
  const { userDetails } = useUserDetails();
  const userId = userDetails?.id ?? null;
  const canFetchPublished = Boolean(userId) && shop !== "custom";
  const [reloadKey, setReloadKey] = useState(0);
  const [localScreenshots, setLocalScreenshots] = useState<LocalScreenshot[]>(
    []
  );
  const [hasLoadedLocal, setHasLoadedLocal] = useState(false);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (!userId) return null;
      const response = await window.electron.hydraApi.get<ScreenshotsResponse>(
        buildUserScreenshotsPath({
          userId,
          cursor,
          take,
          sort,
          shop,
          objectId,
        }),
        { needsAuth: true }
      );
      return response ?? null;
    },
    [objectId, shop, sort, take, userId]
  );

  const collection = useScreenshotCollection({
    feedKey:
      isEnabled && canFetchPublished
        ? [userId, shop, objectId, sort, take, reloadKey].join(":")
        : null,
    fetchPage,
    writeBus,
  });

  const pendingLocal = useMemo(
    () => selectPendingLocalScreenshots(localScreenshots, shop, objectId),
    [localScreenshots, objectId, shop]
  );
  const pendingIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const currentIds = pendingLocal.map((item) => item.clientId);
    const hasSettled = pendingIdsRef.current.some(
      (clientId) => !currentIds.includes(clientId)
    );
    pendingIdsRef.current = currentIds;
    if (hasSettled) setReloadKey((current) => current + 1);
  }, [pendingLocal]);

  useEffect(() => {
    if (!isEnabled) return;
    let isCurrent = true;

    const loadLocal = () => {
      loadLocalScreenshotsForGame(shop, objectId)
        .then((screenshots) => {
          if (!isCurrent) return;
          setLocalScreenshots(screenshots);
          setHasLoadedLocal(true);
        })
        .catch((error) => {
          logger.error("Failed to load local screenshots", error);
          if (isCurrent) setHasLoadedLocal(true);
        });
    };

    loadLocal();
    const unsubscribeLocal = window.electron.onLocalScreenshotsChange(
      (screenshots) =>
        setLocalScreenshots(
          screenshots.filter((screenshot) =>
            isLocalScreenshotForGame(screenshot, shop, objectId)
          )
        )
    );
    const unsubscribeChanged = subscribeMyScreenshotsChanged(() => {
      loadLocal();
      setReloadKey((current) => current + 1);
    });

    return () => {
      isCurrent = false;
      unsubscribeLocal();
      unsubscribeChanged();
    };
  }, [isEnabled, objectId, shop]);

  const items = useMemo(
    () => mergeMyScreenshots(collection.feed.items, pendingLocal, sort),
    [collection.feed.items, pendingLocal, sort]
  );

  const hasLoaded =
    hasLoadedLocal && (!canFetchPublished || collection.feed.hasLoaded);

  return {
    collection,
    pendingLocal,
    items,
    hasLoaded,
    canFetchPublished,
  };
}

export type MyGameScreenshots = ReturnType<typeof useMyGameScreenshots>;
