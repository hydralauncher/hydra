import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileScreenshot, ScreenshotsHiddenReason } from "@types";
import {
  applyScreenshotFeedWrites,
  applyScreenshotPatch,
  buildUserScreenshotPath,
  createScreenshotImageRefresher,
  isRelativeScreenshotPatch,
  mergeScreenshotPages,
  type ScreenshotFeedWrite,
  type ScreenshotImageRefresher,
  type ScreenshotBusWrite,
  type ScreenshotPatch,
  type ScreenshotWriteBus,
} from "@shared";
import { logger } from "@renderer/logger";

import { useScreenshotImageRefresh } from "./use-screenshot-image-refresh";

interface ScreenshotFeedResponse {
  items?: ProfileScreenshot[] | null;
  total?: number;
  hiddenReason?: ScreenshotsHiddenReason;
  nextCursor?: string | null;
}

export type ScreenshotFeedError = "initial" | "page" | null;

interface UseScreenshotFeedOptions {
  requestKey: string | null;
  buildPath: (cursor: string | null) => string;
  needsAuth: boolean;
  writeBus?: ScreenshotWriteBus;
}

export type RemoteScreenshotWriteListener = (write: ScreenshotBusWrite) => void;

export function useScreenshotFeed({
  requestKey,
  buildPath,
  needsAuth,
  writeBus,
}: UseScreenshotFeedOptions) {
  const [items, setItems] = useState<ProfileScreenshot[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hiddenReason, setHiddenReason] =
    useState<ScreenshotsHiddenReason>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [error, setError] = useState<ScreenshotFeedError>(null);
  const generationRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const buildPathRef = useRef(buildPath);
  const needsAuthRef = useRef(needsAuth);
  needsAuthRef.current = needsAuth;

  const itemsRef = useRef(items);
  const writeVersionRef = useRef(0);
  const writesRef = useRef<ScreenshotFeedWrite[]>([]);
  const pendingReadsRef = useRef(0);
  const fetchedAtRef = useRef(new Map<string, number>());
  const lastDeltaVersionRef = useRef(new Map<string, number>());

  const beginRead = () => {
    pendingReadsRef.current += 1;
    return {
      sinceVersion: writeVersionRef.current,
      startedAt: performance.now(),
    };
  };

  const endRead = () => {
    pendingReadsRef.current = Math.max(0, pendingReadsRef.current - 1);
    if (pendingReadsRef.current === 0) writesRef.current = [];
  };

  const recountItem = async (item: ProfileScreenshot) => {
    const generation = generationRef.current;
    const startedVersion = writeVersionRef.current;

    try {
      const fresh =
        await globalThis.window.electron.hydraApi.get<ProfileScreenshot | null>(
          buildUserScreenshotPath(item.owner.id, item.id),
          { needsAuth: needsAuthRef.current }
        );
      if (!fresh || generationRef.current !== generation) return;

      const lastDeltaVersion = lastDeltaVersionRef.current.get(item.id) ?? 0;
      if (lastDeltaVersion > startedVersion) {
        void recountItemRef.current(item);
        return;
      }

      updateItemRef.current(item.id, { commentCount: fresh.commentCount });
    } catch (error) {
      logger.warn("Failed to refresh the screenshot comment count", error);
    }
  };

  const recountItemRef = useRef(recountItem);
  recountItemRef.current = recountItem;

  const acceptPage = (
    pageItems: ProfileScreenshot[],
    read: { sinceVersion: number; startedAt: number }
  ) => {
    const merged = applyScreenshotFeedWrites(
      pageItems,
      writesRef.current,
      read.sinceVersion
    );
    for (const item of merged.items) {
      fetchedAtRef.current.set(item.id, read.startedAt);
    }
    for (const item of merged.items) {
      if (merged.recountIds.has(item.id)) void recountItemRef.current(item);
    }
    return merged;
  };

  buildPathRef.current = buildPath;
  itemsRef.current = items;

  const resetKey = `${needsAuth}:${requestKey ?? ""}`;
  const lastResetKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    isLoadingMoreRef.current = false;
    setIsLoadingMore(false);
    setError(null);
    pendingReadsRef.current = 0;
    writesRef.current = [];

    if (lastResetKeyRef.current !== resetKey) {
      lastResetKeyRef.current = resetKey;
      setItems([]);
      setTotal(null);
      setHiddenReason(null);
      setNextCursor(null);
      setLoadedKey(null);
      fetchedAtRef.current.clear();
    }

    if (!requestKey) return;

    const read = beginRead();

    globalThis.window.electron.hydraApi
      .get<ScreenshotFeedResponse | null>(buildPathRef.current(null), {
        needsAuth,
      })
      .then((response) => {
        if (generationRef.current !== generation) return;

        const merged = acceptPage(response?.items ?? [], read);
        setItems(merged.items);
        setTotal(
          typeof response?.total === "number"
            ? Math.max(0, response.total + merged.netCountDelta)
            : null
        );
        setHiddenReason(response?.hiddenReason ?? null);
        setNextCursor(response?.nextCursor ?? null);
      })
      .catch((error: unknown) => {
        if (generationRef.current !== generation) return;

        logger.error("Failed to load screenshots", error);
        setItems([]);
        setTotal(null);
        setHiddenReason(null);
        setNextCursor(null);
        setError("initial");
      })
      .finally(() => {
        if (generationRef.current !== generation) return;

        endRead();
        setLoadedKey(requestKey);
      });
  }, [needsAuth, refreshToken, requestKey, resetKey]);

  const fetchNextPage = useCallback(async () => {
    if (!requestKey || !nextCursor || isLoadingMoreRef.current) return;

    const generation = generationRef.current;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    const read = beginRead();

    try {
      const response =
        await globalThis.window.electron.hydraApi.get<ScreenshotFeedResponse | null>(
          buildPathRef.current(nextCursor),
          { needsAuth }
        );

      if (generationRef.current !== generation) return;

      const merged = acceptPage(response?.items ?? [], read);
      setItems((current) => mergeScreenshotPages(current, merged.items));
      const incomingTotal = response?.total;
      if (typeof incomingTotal === "number" && !merged.hasLaterWrites)
        setTotal(incomingTotal);
      setNextCursor(response?.nextCursor ?? null);
    } catch (loadError) {
      logger.error("Failed to load more screenshots", loadError);
      if (generationRef.current === generation) setError("page");
    } finally {
      if (generationRef.current === generation) {
        endRead();
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [needsAuth, nextCursor, requestKey]);

  const loadMore = useCallback(async () => {
    if (error) return;

    await fetchNextPage();
  }, [error, fetchNextPage]);

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  const retry = useCallback(() => {
    setError(null);

    if (error === "page") {
      void fetchNextPage();
      return;
    }

    refresh();
  }, [error, fetchNextPage, refresh]);

  const recordWrite = useCallback(
    (screenshotId: string, patch: ScreenshotPatch | null) => {
      writeVersionRef.current += 1;
      if (pendingReadsRef.current === 0) return;

      writesRef.current.push({
        version: writeVersionRef.current,
        screenshotId,
        patch,
      });
    },
    []
  );

  const applyItemPatch = useCallback(
    (screenshotId: string, update: ScreenshotPatch) => {
      recordWrite(screenshotId, update);
      if (isRelativeScreenshotPatch(update)) {
        lastDeltaVersionRef.current.set(screenshotId, writeVersionRef.current);
      }
      setItems((current) =>
        current.map((item) =>
          item.id === screenshotId ? applyScreenshotPatch(item, update) : item
        )
      );
    },
    [recordWrite]
  );

  const publishRef = useRef<((write: ScreenshotBusWrite) => void) | null>(null);
  const remoteListenersRef = useRef(new Set<RemoteScreenshotWriteListener>());

  const updateItem = useCallback(
    (screenshotId: string, update: ScreenshotPatch) => {
      applyItemPatch(screenshotId, update);
      publishRef.current?.({ screenshotId, patch: update });
    },
    [applyItemPatch]
  );

  const updateItemRef = useRef(updateItem);
  updateItemRef.current = updateItem;

  const applyItemRemoval = useCallback(
    (screenshotId: string) => {
      recordWrite(screenshotId, null);
      fetchedAtRef.current.delete(screenshotId);
      if (!itemsRef.current.some((item) => item.id === screenshotId)) return;

      setItems((current) => current.filter((item) => item.id !== screenshotId));
      setTotal((currentTotal) =>
        currentTotal === null ? null : Math.max(0, currentTotal - 1)
      );
    },
    [recordWrite]
  );

  const removeItem = useCallback(
    (screenshotId: string) => {
      applyItemRemoval(screenshotId);
      publishRef.current?.({ screenshotId, patch: null });
    },
    [applyItemRemoval]
  );

  useEffect(() => {
    if (!writeBus) return;

    const subscription = writeBus.subscribe((write) => {
      if (write.patch === null) applyItemRemoval(write.screenshotId);
      else applyItemPatch(write.screenshotId, write.patch);

      for (const listener of remoteListenersRef.current) listener(write);
    });
    publishRef.current = subscription.publish;

    return () => {
      publishRef.current = null;
      subscription.unsubscribe();
    };
  }, [applyItemPatch, applyItemRemoval, writeBus]);

  const subscribeRemoteWrites = useCallback(
    (listener: RemoteScreenshotWriteListener) => {
      remoteListenersRef.current.add(listener);
      return () => {
        remoteListenersRef.current.delete(listener);
      };
    },
    []
  );

  const imageRefresherRef = useRef<ScreenshotImageRefresher | null>(null);
  imageRefresherRef.current ??= createScreenshotImageRefresher();
  const imageRefresher = imageRefresherRef.current;
  const refreshImage = useScreenshotImageRefresh(
    needsAuth,
    updateItem,
    imageRefresher
  );

  const getFetchedAt = useCallback(
    (screenshotId: string) => fetchedAtRef.current.get(screenshotId) ?? null,
    []
  );

  const isLoaded = Boolean(requestKey) && loadedKey === requestKey;

  return {
    items: isLoaded ? items : [],
    total: isLoaded ? total : null,
    hiddenReason: isLoaded ? hiddenReason : null,
    isLoading: Boolean(requestKey) && !isLoaded,
    isLoadingMore,
    hasMore: isLoaded && Boolean(nextCursor),
    error: isLoaded ? error : null,
    retry,
    loadMore,
    refresh,
    updateItem,
    refreshImage,
    imageRefresher,
    subscribeRemoteWrites,
    removeItem,
    getFetchedAt,
  };
}
