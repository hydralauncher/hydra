import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GameShop, LocalScreenshot, ScreenshotSort } from "@types";
import {
  buildUserScreenshotsPath,
  createLocalSnapshotGuard,
  isLocalScreenshotForGame,
  isLocalScreenshotPending,
  mergeMyScreenshots,
  resolveMyGameScreenshotsStatus,
  selectPendingLocalScreenshots,
  subscribeMyGameScreenshotsChanged,
  type ScreenshotWriteBus,
} from "@shared";
import { logger } from "@renderer/logger";
import { myGameScreenshotsLocal } from "@renderer/pages/game-details/game-screenshots/my-game-screenshots-bridge";

import { useUserDetails } from "../../../../hooks";
import { NavigationService } from "../../../../services";
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
  uploadedIds: ReadonlySet<string>;
  hasLoaded: boolean;
  hasFailed: boolean;
}

const NOT_LOADED_LOCAL_SCREENSHOTS: LoadedLocalScreenshots = {
  targetKey: null,
  screenshots: [],
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
    previous.screenshots
      .filter(isLocalScreenshotPending)
      .map((item) => item.clientId)
  );
  const uploadedIds = new Set<string>();
  for (const item of screenshots) {
    if (item.state !== "uploaded") continue;
    if (
      previous.uploadedIds.has(item.clientId) ||
      wasPending.has(item.clientId)
    ) {
      uploadedIds.add(item.clientId);
    }
  }
  return uploadedIds;
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
  const { screenshots, uploadedIds, hasLoaded, hasFailed } =
    loaded.targetKey === targetKey ? loaded : NOT_LOADED_LOCAL_SCREENSHOTS;
  const snapshotGuardRef = useRef(createLocalSnapshotGuard());

  const load = useCallback(() => {
    const snapshots = snapshotGuardRef.current;
    const startedAt = snapshots.beginRead();
    return myGameScreenshotsLocal
      .getLocalScreenshotsForGame(shop, objectId)
      .then((items) => {
        if (!snapshots.isCurrentRead(startedAt)) return;
        setLoaded((previous) => ({
          targetKey,
          screenshots: items,
          uploadedIds: trackUploadedIds(previous, targetKey, items),
          hasLoaded: true,
          hasFailed: false,
        }));
      })
      .catch((error: unknown) => {
        logger.error("Failed to load local screenshots for the game", error);
        if (!snapshots.isCurrentRead(startedAt)) return;
        setLoaded((previous) => ({
          targetKey,
          screenshots:
            previous.targetKey === targetKey ? previous.screenshots : [],
          uploadedIds:
            previous.targetKey === targetKey ? previous.uploadedIds : new Set(),
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
        const forGame = items.filter((item) =>
          isLocalScreenshotForGame(item, shop, objectId)
        );
        setLoaded((previous) => ({
          targetKey,
          screenshots: forGame,
          uploadedIds: trackUploadedIds(previous, targetKey, forGame),
          hasLoaded: true,
          hasFailed: false,
        }));
      }
    );
    const unsubscribeProgress =
      globalThis.window.electron.onScreenshotUploadProgress((progress) => {
        if (!isCurrent) return;
        setLoaded((previous) => {
          const screenshots = previous.screenshots.map((item) =>
            item.clientId === progress.clientId
              ? {
                  ...item,
                  state: progress.state,
                  uploadProgress: progress.progress ?? item.uploadProgress,
                }
              : item
          );
          return {
            ...previous,
            screenshots,
            uploadedIds: trackUploadedIds(previous, targetKey, screenshots),
          };
        });
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
    uploadedIds,
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

  const [uploadSeenAt, setUploadSeenAt] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  );
  const { uploadedIds } = local;
  const { loadCount } = feed;

  useEffect(() => {
    const unseenIds = [...uploadedIds].filter(
      (clientId) => !uploadSeenAt.has(clientId)
    );
    if (unseenIds.length === 0) return;

    setUploadSeenAt((current) => {
      const next = new Map(current);
      for (const clientId of unseenIds) next.set(clientId, loadCount);
      return next;
    });
  }, [loadCount, uploadSeenAt, uploadedIds]);

  const visibleLocal = useMemo(() => {
    if (!canFetchPublished || uploadedIds.size === 0) return local.pending;

    const feedIds = new Set(feed.items.map((item) => item.id));
    const awaitingFeed = local.all.filter(
      (item) =>
        uploadedIds.has(item.clientId) &&
        (uploadSeenAt.get(item.clientId) ?? loadCount) === loadCount &&
        !(item.screenshotId && feedIds.has(item.screenshotId))
    );
    if (awaitingFeed.length === 0) return local.pending;

    return [...local.pending, ...awaitingFeed].toSorted(
      (a, b) => b.capturedAt - a.capturedAt
    );
  }, [
    canFetchPublished,
    feed.items,
    loadCount,
    local.all,
    local.pending,
    uploadSeenAt,
    uploadedIds,
  ]);

  const items = useMemo(
    () => mergeMyScreenshots(feed.items, visibleLocal, sort),
    [feed.items, sort, visibleLocal]
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
    pendingLocal: visibleLocal,
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

export function useFocusFollowsPublishedLocal(
  visibleLocal: LocalScreenshot[],
  publishedIds: string[],
  getLocalFocusId: (clientId: string) => string,
  getPublishedFocusId: (screenshotId: string) => string
) {
  const shownLocalRef = useRef<LocalScreenshot[]>([]);
  const followTargetRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const focusedId = NavigationService.getInstance().getCurrentFocusId();
    const visibleIds = new Set(visibleLocal.map((item) => item.clientId));
    const replaced = shownLocalRef.current.find(
      (item) =>
        !visibleIds.has(item.clientId) &&
        item.screenshotId !== null &&
        publishedIds.includes(item.screenshotId) &&
        focusedId === getLocalFocusId(item.clientId)
    );
    shownLocalRef.current = visibleLocal;
    followTargetRef.current = replaced?.screenshotId
      ? getPublishedFocusId(replaced.screenshotId)
      : null;
  });

  useEffect(() => {
    const target = followTargetRef.current;
    if (!target) return;

    followTargetRef.current = null;
    NavigationService.getInstance().setFocus(target);
  });
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
