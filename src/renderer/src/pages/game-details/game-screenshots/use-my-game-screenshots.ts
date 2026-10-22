import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useScreenshotCollection } from "@renderer/components/screenshots";
import { useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  buildUserScreenshotsPath,
  isLocalScreenshotForGame,
  mergeMyScreenshots,
  resolveMyGameScreenshotsStatus,
  selectPendingLocalScreenshots,
  subscribeMyGameScreenshotsChanged,
  type ScreenshotWriteBus,
} from "@shared";
import type {
  GameShop,
  LocalScreenshot,
  ScreenshotSort,
  ScreenshotsResponse,
} from "@types";

import { myGameScreenshotsLocal } from "./my-game-screenshots-bridge";

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
  const [hasLocalFailed, setHasLocalFailed] = useState(false);
  const [localReloadKey, setLocalReloadKey] = useState(0);

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
    () => selectPendingLocalScreenshots(localScreenshots, { shop, objectId }),
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
      myGameScreenshotsLocal
        .getLocalScreenshotsForGame(shop, objectId)
        .then((screenshots) => {
          if (!isCurrent) return;
          setLocalScreenshots(screenshots);
          setHasLocalFailed(false);
          setHasLoadedLocal(true);
        })
        .catch((error) => {
          logger.error("Failed to load local screenshots", error);
          if (!isCurrent) return;
          setHasLocalFailed(true);
          setHasLoadedLocal(true);
        });
    };

    loadLocal();
    const unsubscribeLocal = window.electron.onLocalScreenshotsChange(
      (screenshots) => {
        setLocalScreenshots(
          screenshots.filter((screenshot) =>
            isLocalScreenshotForGame(screenshot, shop, objectId)
          )
        );
        setHasLocalFailed(false);
        setHasLoadedLocal(true);
      }
    );
    const unsubscribeChanged = subscribeMyGameScreenshotsChanged(() => {
      loadLocal();
      setReloadKey((current) => current + 1);
    });

    return () => {
      isCurrent = false;
      unsubscribeLocal();
      unsubscribeChanged();
    };
  }, [isEnabled, localReloadKey, objectId, shop]);

  const items = useMemo(
    () => mergeMyScreenshots(collection.feed.items, pendingLocal, sort),
    [collection.feed.items, pendingLocal, sort]
  );

  const { feed } = collection;
  const status = resolveMyGameScreenshotsStatus({
    local: { isLoaded: hasLoadedLocal, hasFailed: hasLocalFailed },
    published: {
      isEnabled: canFetchPublished,
      isLoaded: feed.hasLoaded,
      hasFailed: feed.hasFailed,
    },
  });
  const { reload } = feed;

  const retry = useCallback(() => {
    setHasLoadedLocal(false);
    setHasLocalFailed(false);
    setLocalReloadKey((current) => current + 1);
    if (canFetchPublished) void reload();
  }, [canFetchPublished, reload]);

  return {
    collection,
    pendingLocal,
    items,
    status,
    hasLoaded: status !== "loading",
    hasFailed: status === "failed",
    hasLocalFailed,
    canFetchPublished,
    retry,
  };
}

export type MyGameScreenshots = ReturnType<typeof useMyGameScreenshots>;
