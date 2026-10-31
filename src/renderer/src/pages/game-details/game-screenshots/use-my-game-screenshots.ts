import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useScreenshotCollection } from "@renderer/components/screenshots";
import { useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  buildUserScreenshotsPath,
  createLocalSnapshotGuard,
  isLocalScreenshotForGame,
  isLocalScreenshotPending,
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
  ProfileScreenshot,
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

interface LoadedLocalScreenshots {
  targetKey: string | null;
  localScreenshots: LocalScreenshot[];
  uploadedIds: ReadonlySet<string>;
  hasLoaded: boolean;
  hasFailed: boolean;
}

const NOT_LOADED_LOCAL_SCREENSHOTS: LoadedLocalScreenshots = {
  targetKey: null,
  localScreenshots: [],
  uploadedIds: new Set(),
  hasLoaded: false,
  hasFailed: false,
};

const trackUploadedIds = (
  previous: LoadedLocalScreenshots,
  targetKey: string,
  screenshots: LocalScreenshot[]
): ReadonlySet<string> => {
  if (previous.targetKey !== targetKey) return new Set();

  const wasPending = new Set(
    previous.localScreenshots
      .filter(isLocalScreenshotPending)
      .map((item) => item.clientId)
  );
  return new Set(
    screenshots
      .filter(
        (item) =>
          item.state === "uploaded" &&
          (previous.uploadedIds.has(item.clientId) ||
            wasPending.has(item.clientId))
      )
      .map((item) => item.clientId)
  );
};

interface UseMyLocalGameScreenshotsOptions extends GameTarget {
  isEnabled: boolean;
}

export function useMyLocalGameScreenshots({
  shop,
  objectId,
  isEnabled,
}: UseMyLocalGameScreenshotsOptions) {
  const targetKey = `${shop}:${objectId}`;
  const [loaded, setLoaded] = useState<LoadedLocalScreenshots>(
    NOT_LOADED_LOCAL_SCREENSHOTS
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [settledCount, setSettledCount] = useState(0);
  const loadedForTarget =
    loaded.targetKey === targetKey ? loaded : NOT_LOADED_LOCAL_SCREENSHOTS;
  const { localScreenshots, uploadedIds, hasLoaded, hasFailed } =
    loadedForTarget;

  const pendingLocal = useMemo(
    () => selectPendingLocalScreenshots(localScreenshots, { shop, objectId }),
    [localScreenshots, objectId, shop]
  );
  const pendingRef = useRef<{ targetKey: string; clientIds: string[] }>({
    targetKey,
    clientIds: [],
  });

  useEffect(() => {
    const previous = pendingRef.current;
    pendingRef.current = {
      targetKey,
      clientIds: pendingLocal.map((item) => item.clientId),
    };
    if (previous.targetKey !== targetKey) return;

    const hasUploaded = localScreenshots.some(
      (item) =>
        item.state === "uploaded" && previous.clientIds.includes(item.clientId)
    );
    if (hasUploaded) setSettledCount((current) => current + 1);
  }, [localScreenshots, pendingLocal, targetKey]);

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
          setLoaded((previous) => ({
            targetKey,
            localScreenshots: screenshots,
            uploadedIds: trackUploadedIds(previous, targetKey, screenshots),
            hasLoaded: true,
            hasFailed: false,
          }));
        })
        .catch((error) => {
          logger.error("Failed to load local screenshots", error);
          if (!isCurrent || !snapshots.isCurrentRead(startedAt)) return;
          setLoaded((previous) => ({
            targetKey,
            localScreenshots:
              previous.targetKey === targetKey ? previous.localScreenshots : [],
            uploadedIds:
              previous.targetKey === targetKey
                ? previous.uploadedIds
                : new Set(),
            hasLoaded: true,
            hasFailed: true,
          }));
        });
    };

    loadLocal();
    const unsubscribeLocal = window.electron.onLocalScreenshotsChange(
      (screenshots) => {
        snapshots.noteSnapshot();
        const forGame = screenshots.filter((screenshot) =>
          isLocalScreenshotForGame(screenshot, shop, objectId)
        );
        setLoaded((previous) => ({
          targetKey,
          localScreenshots: forGame,
          uploadedIds: trackUploadedIds(previous, targetKey, forGame),
          hasLoaded: true,
          hasFailed: false,
        }));
      }
    );
    const unsubscribeChanged = subscribeMyGameScreenshotsChanged(loadLocal);

    return () => {
      isCurrent = false;
      unsubscribeLocal();
      unsubscribeChanged();
    };
  }, [isEnabled, objectId, reloadKey, shop, targetKey]);

  const retry = useCallback(() => {
    setLoaded((previous) => ({
      ...previous,
      hasLoaded: false,
      hasFailed: false,
    }));
    setReloadKey((current) => current + 1);
  }, []);

  return {
    localScreenshots,
    pendingLocal,
    uploadedIds,
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

interface LocalScreenshotsState {
  localScreenshots: LocalScreenshot[];
  pendingLocal: LocalScreenshot[];
  uploadedIds: ReadonlySet<string>;
}

interface PublishedFeedState {
  items: ProfileScreenshot[];
  loadedRequestId: number;
  getLatestRequestId: () => number;
}

export function useVisibleLocalScreenshots(
  local: LocalScreenshotsState,
  feed: PublishedFeedState,
  canFetchPublished: boolean
) {
  const { localScreenshots, pendingLocal, uploadedIds } = local;
  const { items: feedItems, loadedRequestId, getLatestRequestId } = feed;
  const [uploadSeenAt, setUploadSeenAt] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  );

  useEffect(() => {
    const hasStaleEntries = [...uploadSeenAt.keys()].some(
      (clientId) => !uploadedIds.has(clientId)
    );
    const unseenIds = [...uploadedIds].filter(
      (clientId) => !uploadSeenAt.has(clientId)
    );
    if (!hasStaleEntries && unseenIds.length === 0) return;

    const requestId = getLatestRequestId();
    setUploadSeenAt((current) => {
      const next = new Map(
        [...current].filter(([clientId]) => uploadedIds.has(clientId))
      );
      for (const clientId of unseenIds) next.set(clientId, requestId);
      return next;
    });
  }, [getLatestRequestId, uploadSeenAt, uploadedIds]);

  return useMemo(() => {
    if (!canFetchPublished || uploadedIds.size === 0) return pendingLocal;

    const feedIds = new Set(feedItems.map((item) => item.id));
    const hasFeedLoadedSinceUpload = (clientId: string) => {
      const seenAt = uploadSeenAt.get(clientId);
      return seenAt !== undefined && loadedRequestId > seenAt;
    };
    const awaitingFeed = localScreenshots.filter(
      (item) =>
        uploadedIds.has(item.clientId) &&
        !hasFeedLoadedSinceUpload(item.clientId) &&
        !(item.screenshotId && feedIds.has(item.screenshotId))
    );
    if (awaitingFeed.length === 0) return pendingLocal;

    return [...pendingLocal, ...awaitingFeed].toSorted(
      (a, b) => b.capturedAt - a.capturedAt
    );
  }, [
    canFetchPublished,
    feedItems,
    loadedRequestId,
    localScreenshots,
    pendingLocal,
    uploadSeenAt,
    uploadedIds,
  ]);
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
  const visibleLocal = useVisibleLocalScreenshots(
    local,
    feed,
    canFetchPublished
  );

  const items = useMemo(() => {
    const visibleLocalInRange =
      sort === "recent"
        ? selectPendingLocalWithinLoadedUploads(
            visibleLocal,
            feed.items,
            feed.hasMore
          )
        : visibleLocal;
    return mergeMyScreenshots(feed.items, visibleLocalInRange, sort);
  }, [feed.hasMore, feed.items, sort, visibleLocal]);

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
    items,
    hasLoaded: status !== "loading",
    hasFailed: status === "failed",
    isPartial: status === "partial",
    hasLocalFailed,
    retry,
    retryFailed,
  };
}
