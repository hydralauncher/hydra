import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameShop, LocalScreenshot, ScreenshotSort } from "@types";
import {
  buildUserScreenshotsPath,
  createLocalSnapshotGuard,
  isLocalScreenshotForGame,
  mergeMyScreenshots,
  resolveMyGameScreenshotsStatus,
  selectPendingLocalScreenshots,
  subscribeMyGameScreenshotsChanged,
  type ScreenshotWriteBus,
} from "@shared";
import { logger } from "@renderer/logger";
import { myGameScreenshotsLocal } from "@renderer/pages/game-details/game-screenshots/my-game-screenshots-bridge";

import { useUserDetails } from "../../../../hooks";
import { useScreenshotFeed } from "../../screenshots";

interface UseMyGameScreenshotsOptions {
  shop: GameShop;
  objectId: string;
  sort: ScreenshotSort;
  take: number;
  isEnabled: boolean;
  writeBus?: ScreenshotWriteBus;
  feedKeySuffix: string;
}

interface LoadedLocalScreenshots {
  targetKey: string | null;
  screenshots: LocalScreenshot[];
  hasLoaded: boolean;
  hasFailed: boolean;
}

const NOT_LOADED_LOCAL_SCREENSHOTS: LoadedLocalScreenshots = {
  targetKey: null,
  screenshots: [],
  hasLoaded: false,
  hasFailed: false,
};

export function usePendingLocalScreenshots(
  shop: GameShop,
  objectId: string,
  isEnabled: boolean
) {
  const targetKey = `${shop}:${objectId}`;
  const [loaded, setLoaded] = useState<LoadedLocalScreenshots>(
    NOT_LOADED_LOCAL_SCREENSHOTS
  );
  const { screenshots, hasLoaded, hasFailed } =
    loaded.targetKey === targetKey ? loaded : NOT_LOADED_LOCAL_SCREENSHOTS;
  const snapshotGuardRef = useRef(createLocalSnapshotGuard());

  const load = useCallback(() => {
    const snapshots = snapshotGuardRef.current;
    const startedAt = snapshots.beginRead();
    return myGameScreenshotsLocal
      .getLocalScreenshotsForGame(shop, objectId)
      .then((items) => {
        if (!snapshots.isCurrentRead(startedAt)) return;
        setLoaded({
          targetKey,
          screenshots: items,
          hasLoaded: true,
          hasFailed: false,
        });
      })
      .catch((error: unknown) => {
        logger.error("Failed to load local screenshots for the game", error);
        if (!snapshots.isCurrentRead(startedAt)) return;
        setLoaded((previous) => ({
          targetKey,
          screenshots:
            previous.targetKey === targetKey ? previous.screenshots : [],
          hasLoaded: true,
          hasFailed: true,
        }));
      });
  }, [objectId, shop, targetKey]);

  const retry = useCallback(() => {
    setLoaded((previous) => ({
      ...previous,
      hasLoaded: false,
      hasFailed: false,
    }));
    return load();
  }, [load]);

  useEffect(() => {
    if (!isEnabled) return;
    let isCurrent = true;
    const snapshots = createLocalSnapshotGuard();
    snapshotGuardRef.current = snapshots;

    const loadIfCurrent = () => {
      if (isCurrent) void load();
    };

    loadIfCurrent();
    const unsubscribeLocal = myGameScreenshotsLocal.onLocalScreenshotsChange(
      (items) => {
        if (!isCurrent) return;
        snapshots.noteSnapshot();
        setLoaded({
          targetKey,
          screenshots: items.filter((item) =>
            isLocalScreenshotForGame(item, shop, objectId)
          ),
          hasLoaded: true,
          hasFailed: false,
        });
      }
    );
    const unsubscribeProgress =
      globalThis.window.electron.onScreenshotUploadProgress((progress) => {
        if (!isCurrent) return;
        setLoaded((previous) => ({
          ...previous,
          screenshots: previous.screenshots.map((item) =>
            item.clientId === progress.clientId
              ? {
                  ...item,
                  state: progress.state,
                  uploadProgress: progress.progress ?? item.uploadProgress,
                }
              : item
          ),
        }));
      });

    return () => {
      isCurrent = false;
      unsubscribeLocal();
      unsubscribeProgress();
    };
  }, [isEnabled, load, objectId, shop, targetKey]);

  const pending = useMemo(
    () => selectPendingLocalScreenshots(screenshots, { shop, objectId }),
    [objectId, screenshots, shop]
  );

  return {
    all: screenshots,
    pending,
    hasLoaded,
    hasFailed,
    reload: load,
    retry,
  };
}

export function useMyPublishedScreenshots({
  shop,
  objectId,
  sort,
  take,
  isEnabled,
  writeBus,
  feedKeySuffix,
}: UseMyGameScreenshotsOptions) {
  const { userDetails } = useUserDetails();
  const userId = userDetails?.id ?? null;
  const canFetchPublished = Boolean(userId) && shop !== "custom";

  const buildPath = useCallback(
    (cursor: string | null) =>
      buildUserScreenshotsPath({
        userId: userId ?? "",
        cursor,
        take,
        sort,
        shop,
        objectId,
      }),
    [objectId, shop, sort, take, userId]
  );

  const feed = useScreenshotFeed({
    requestKey:
      isEnabled && canFetchPublished
        ? [userId, shop, objectId, sort, take, feedKeySuffix].join(":")
        : null,
    buildPath,
    needsAuth: true,
    writeBus,
  });

  return { feed, canFetchPublished };
}

export type MyPublishedScreenshots = ReturnType<
  typeof useMyPublishedScreenshots
>;
export type PendingLocalScreenshots = ReturnType<
  typeof usePendingLocalScreenshots
>;

const noop = () => {};

interface UseMyGameScreenshotsStateOptions {
  local: PendingLocalScreenshots;
  published: MyPublishedScreenshots;
  sort: ScreenshotSort;
  isEnabled: boolean;
  refreshOtherPublished?: () => void;
}

export function useMyGameScreenshotsState({
  local,
  published,
  sort,
  isEnabled,
  refreshOtherPublished = noop,
}: UseMyGameScreenshotsStateOptions) {
  const { feed, canFetchPublished } = published;
  const { refresh } = feed;
  const reloadLocal = local.reload;

  const pendingIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const currentIds = local.pending.map((item) => item.clientId);
    const hasSettled = pendingIdsRef.current.some(
      (clientId) => !currentIds.includes(clientId)
    );
    pendingIdsRef.current = currentIds;
    if (hasSettled) {
      refresh();
      refreshOtherPublished();
    }
  }, [local.pending, refresh, refreshOtherPublished]);

  useEffect(() => {
    if (!isEnabled) return;
    return subscribeMyGameScreenshotsChanged(() => {
      void reloadLocal();
      refresh();
      refreshOtherPublished();
    });
  }, [isEnabled, refresh, refreshOtherPublished, reloadLocal]);

  const items = useMemo(
    () => mergeMyScreenshots(feed.items, local.pending, sort),
    [feed.items, local.pending, sort]
  );

  const hasPublishedFailed =
    canFetchPublished && (feed.error === "initial" || feed.error === "refresh");
  const status = resolveMyGameScreenshotsStatus({
    local: { isLoaded: local.hasLoaded, hasFailed: local.hasFailed },
    published: {
      isEnabled: canFetchPublished,
      isLoaded: !feed.isLoading,
      hasFailed: hasPublishedFailed,
    },
  });
  const retryLocal = local.retry;
  const hasLocalFailed = local.hasFailed;
  const retry = useCallback(() => {
    void retryLocal();
    if (canFetchPublished) refresh();
  }, [canFetchPublished, refresh, retryLocal]);
  const retryFailed = useCallback(() => {
    if (hasLocalFailed) void retryLocal();
    if (hasPublishedFailed) refresh();
  }, [hasLocalFailed, hasPublishedFailed, refresh, retryLocal]);

  return {
    feed,
    localScreenshots: local.all,
    pendingLocal: local.pending,
    hasLoadedLocal: local.hasLoaded,
    items,
    status,
    hasLoaded: status !== "loading",
    hasFailed: status === "failed",
    isPartial: status === "partial",
    hasLocalFailed,
    hasPublishedFailed,
    canFetchPublished,
    retry,
    retryFailed,
  };
}

export function useMyGameScreenshots(options: UseMyGameScreenshotsOptions) {
  const local = usePendingLocalScreenshots(
    options.shop,
    options.objectId,
    options.isEnabled
  );
  const published = useMyPublishedScreenshots(options);

  return useMyGameScreenshotsState({
    local,
    published,
    sort: options.sort,
    isEnabled: options.isEnabled,
  });
}

export type MyGameScreenshots = ReturnType<typeof useMyGameScreenshots>;
