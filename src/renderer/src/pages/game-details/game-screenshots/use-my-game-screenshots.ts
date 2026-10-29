import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useScreenshotCollection } from "@renderer/components/screenshots";
import { useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  buildUserScreenshotsPath,
  createLocalSnapshotGuard,
  isLocalScreenshotForGame,
  mergeMyScreenshots,
  resolveMyGameScreenshotsStatus,
  selectPendingLocalScreenshots,
  selectPendingLocalWithinLoadedUploads,
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

interface GameTarget {
  shop: GameShop;
  objectId: string;
}

export function useCanFetchMyPublishedScreenshots(shop: GameShop) {
  const { userDetails } = useUserDetails();
  const userId = userDetails?.id ?? null;
  return { userId, canFetchPublished: Boolean(userId) && shop !== "custom" };
}

interface UseMyLocalGameScreenshotsOptions extends GameTarget {
  isEnabled: boolean;
}

export function useMyLocalGameScreenshots({
  shop,
  objectId,
  isEnabled,
}: UseMyLocalGameScreenshotsOptions) {
  const [localScreenshots, setLocalScreenshots] = useState<LocalScreenshot[]>(
    []
  );
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledCount, setSettledCount] = useState(0);

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
    if (hasSettled) setSettledCount((current) => current + 1);
  }, [pendingLocal]);

  useEffect(() => {
    if (!isEnabled) return;
    let isCurrent = true;
    const snapshots = createLocalSnapshotGuard();

    const loadLocal = () => {
      const startedAt = snapshots.beginRead();
      myGameScreenshotsLocal
        .getLocalScreenshotsForGame(shop, objectId)
        .then((screenshots) => {
          if (!isCurrent || !snapshots.isCurrentRead(startedAt)) return;
          setLocalScreenshots(screenshots);
          setHasFailed(false);
          setHasLoaded(true);
        })
        .catch((error) => {
          logger.error("Failed to load local screenshots", error);
          if (!isCurrent || !snapshots.isCurrentRead(startedAt)) return;
          setHasFailed(true);
          setHasLoaded(true);
        });
    };

    loadLocal();
    const unsubscribeLocal = window.electron.onLocalScreenshotsChange(
      (screenshots) => {
        snapshots.noteSnapshot();
        setLocalScreenshots(
          screenshots.filter((screenshot) =>
            isLocalScreenshotForGame(screenshot, shop, objectId)
          )
        );
        setHasFailed(false);
        setHasLoaded(true);
      }
    );
    const unsubscribeChanged = subscribeMyGameScreenshotsChanged(loadLocal);

    return () => {
      isCurrent = false;
      unsubscribeLocal();
      unsubscribeChanged();
    };
  }, [isEnabled, objectId, reloadKey, shop]);

  const retry = useCallback(() => {
    setHasLoaded(false);
    setHasFailed(false);
    setReloadKey((current) => current + 1);
  }, []);

  return {
    localScreenshots,
    pendingLocal,
    hasLoaded,
    hasFailed,
    settledCount,
    retry,
  };
}

interface UseMyPublishedGameScreenshotsOptions extends GameTarget {
  sort: ScreenshotSort;
  take: number;
  isEnabled: boolean;
  writeBus: ScreenshotWriteBus;
  settledCount: number;
}

export function useMyPublishedGameScreenshots({
  shop,
  objectId,
  sort,
  take,
  isEnabled,
  writeBus,
  settledCount,
}: UseMyPublishedGameScreenshotsOptions) {
  const { userId, canFetchPublished } = useCanFetchMyPublishedScreenshots(shop);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isEnabled) return;
    return subscribeMyGameScreenshotsChanged(() =>
      setReloadKey((current) => current + 1)
    );
  }, [isEnabled]);

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

  return useScreenshotCollection({
    feedKey:
      isEnabled && canFetchPublished
        ? [userId, shop, objectId, sort, take].join(":")
        : null,
    refreshKey: `${reloadKey}:${settledCount}`,
    fetchPage,
    writeBus,
  });
}

interface UseMyGameScreenshotsOptions extends GameTarget {
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
  const { canFetchPublished } = useCanFetchMyPublishedScreenshots(shop);
  const local = useMyLocalGameScreenshots({ shop, objectId, isEnabled });
  const collection = useMyPublishedGameScreenshots({
    shop,
    objectId,
    sort,
    take,
    isEnabled,
    writeBus,
    settledCount: local.settledCount,
  });
  const { feed } = collection;

  const items = useMemo(() => {
    const visiblePendingLocal =
      sort === "recent"
        ? selectPendingLocalWithinLoadedUploads(
            local.pendingLocal,
            feed.items,
            feed.hasMore
          )
        : local.pendingLocal;
    return mergeMyScreenshots(feed.items, visiblePendingLocal, sort);
  }, [feed.hasMore, feed.items, local.pendingLocal, sort]);

  const status = resolveMyGameScreenshotsStatus({
    local: { isLoaded: local.hasLoaded, hasFailed: local.hasFailed },
    published: {
      isEnabled: canFetchPublished,
      isLoaded: feed.hasLoaded,
      hasFailed: feed.hasFailed,
    },
  });
  const hasPublishedFailed = canFetchPublished && feed.hasFailed;
  const { reload } = feed;
  const { retry: retryLocal, hasFailed: hasLocalFailed } = local;

  const retry = useCallback(() => {
    retryLocal();
    if (canFetchPublished) void reload();
  }, [canFetchPublished, reload, retryLocal]);

  const retryFailed = useCallback(() => {
    if (hasLocalFailed) retryLocal();
    if (hasPublishedFailed) void reload();
  }, [hasLocalFailed, hasPublishedFailed, reload, retryLocal]);

  return {
    collection,
    localScreenshots: local.localScreenshots,
    pendingLocal: local.pendingLocal,
    items,
    status,
    hasLoaded: status !== "loading",
    hasFailed: status === "failed",
    isPartial: status === "partial",
    hasLocalFailed,
    retry,
    retryFailed,
  };
}

export type MyGameScreenshots = ReturnType<typeof useMyGameScreenshots>;
