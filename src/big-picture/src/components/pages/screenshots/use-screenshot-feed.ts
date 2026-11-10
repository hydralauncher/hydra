import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileScreenshot, ScreenshotsHiddenReason } from "@types";
import {
  applyScreenshotPatch,
  buildUserScreenshotPath,
  createScreenshotImageRefresher,
  mergeScreenshotPages,
  ScreenshotFeedLedger,
  type ScreenshotFeedRead,
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

export type ScreenshotFeedError = "initial" | "refresh" | "page" | null;

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
  const [loadCount, setLoadCount] = useState(0);
  const generationRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const isReadPendingRef = useRef(false);
  const loadedPageCountRef = useRef(0);
  const buildPathRef = useRef(buildPath);
  const needsAuthRef = useRef(needsAuth);
  needsAuthRef.current = needsAuth;

  const itemsRef = useRef(items);
  const ledgerRef = useRef<ScreenshotFeedLedger | null>(null);
  ledgerRef.current ??= new ScreenshotFeedLedger();
  const ledger = ledgerRef.current;

  const recountItem = useCallback(
    (item: ProfileScreenshot) => {
      const generation = generationRef.current;
      ledger
        .recountComments(item, {
          fetchScreenshot: (screenshot) =>
            globalThis.window.electron.hydraApi.get<ProfileScreenshot | null>(
              buildUserScreenshotPath(screenshot.owner.id, screenshot.id),
              { needsAuth: needsAuthRef.current }
            ),
          isCurrent: () => generationRef.current === generation,
          applyPatch: (screenshotId, patch) =>
            updateItemRef.current(screenshotId, patch),
        })
        .catch((error: unknown) => {
          logger.warn("Failed to refresh the screenshot comment count", error);
        });
    },
    [ledger]
  );

  const acceptPage = useCallback(
    (pageItems: ProfileScreenshot[], read: ScreenshotFeedRead) => {
      const merged = ledger.acceptPage(pageItems, read);
      merged.recountItems.forEach(recountItem);
      return merged;
    },
    [ledger, recountItem]
  );

  buildPathRef.current = buildPath;
  itemsRef.current = items;

  const resetKey = `${needsAuth}:${requestKey ?? ""}`;
  const lastResetKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    isLoadingMoreRef.current = false;
    isReadPendingRef.current = Boolean(requestKey);
    setIsLoadingMore(false);
    setError(null);

    const isRefresh = lastResetKeyRef.current === resetKey;
    if (isRefresh) {
      ledger.cancelReads();
    } else {
      lastResetKeyRef.current = resetKey;
      loadedPageCountRef.current = 0;
      ledger.reset();
      setItems([]);
      setTotal(null);
      setHiddenReason(null);
      setNextCursor(null);
      setLoadedKey(null);
    }

    if (!requestKey) return;

    const read = ledger.beginRead();
    const pagesToLoad = Math.max(1, loadedPageCountRef.current);
    const previousLastId = isRefresh ? itemsRef.current.at(-1)?.id : undefined;
    const fetchPage = (cursor: string | null) =>
      globalThis.window.electron.hydraApi.get<ScreenshotFeedResponse | null>(
        buildPathRef.current(cursor),
        { needsAuth }
      );

    const loadPages = async () => {
      const firstPage = await fetchPage(null);
      let pageItems = firstPage?.items ?? [];
      let cursor = firstPage?.nextCursor ?? null;
      let pageCount = 1;

      const hasReachedPreviousEnd = () =>
        !previousLastId || pageItems.some((item) => item.id === previousLastId);
      const needsAnotherPage = () =>
        pageCount < pagesToLoad ||
        (pageCount === pagesToLoad && !hasReachedPreviousEnd());

      while (cursor && needsAnotherPage()) {
        if (generationRef.current !== generation) return;
        const page = await fetchPage(cursor);
        pageItems = mergeScreenshotPages(pageItems, page?.items ?? []);
        cursor = page?.nextCursor ?? null;
        pageCount += 1;
      }

      if (generationRef.current !== generation) return;

      const merged = acceptPage(pageItems, read);
      loadedPageCountRef.current = pageCount;
      setItems(merged.items);
      setNextCursor(cursor);
      setTotal(
        typeof firstPage?.total === "number"
          ? Math.max(0, firstPage.total + merged.netCountDelta)
          : null
      );
      setHiddenReason(firstPage?.hiddenReason ?? null);
      setLoadCount((current) => current + 1);
    };

    loadPages()
      .catch((error: unknown) => {
        if (generationRef.current !== generation) return;

        if (isRefresh && loadedPageCountRef.current > 0) {
          logger.warn("Failed to refresh screenshots", error);
          setError("refresh");
          return;
        }

        logger.error("Failed to load screenshots", error);
        setItems([]);
        setTotal(null);
        setHiddenReason(null);
        setNextCursor(null);
        setError("initial");
      })
      .finally(() => {
        ledger.endRead(read);
        if (generationRef.current !== generation) return;

        isReadPendingRef.current = false;
        setLoadedKey(requestKey);
      });
  }, [acceptPage, ledger, needsAuth, refreshToken, requestKey, resetKey]);

  const fetchNextPage = useCallback(async () => {
    if (isLoadingMoreRef.current) return true;
    if (!requestKey || !nextCursor || isReadPendingRef.current) return false;

    const generation = generationRef.current;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    const read = ledger.beginRead();

    try {
      const response =
        await globalThis.window.electron.hydraApi.get<ScreenshotFeedResponse | null>(
          buildPathRef.current(nextCursor),
          { needsAuth }
        );

      if (generationRef.current !== generation) return false;

      const merged = acceptPage(response?.items ?? [], read);
      setItems((current) => mergeScreenshotPages(current, merged.items));
      loadedPageCountRef.current += 1;
      const incomingTotal = response?.total;
      if (typeof incomingTotal === "number" && !merged.hasLaterWrites)
        setTotal(incomingTotal);
      setNextCursor(response?.nextCursor ?? null);
    } catch (loadError) {
      logger.error("Failed to load more screenshots", loadError);
      if (generationRef.current === generation) setError("page");
    } finally {
      ledger.endRead(read);
      if (generationRef.current === generation) {
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
    return true;
  }, [acceptPage, ledger, needsAuth, nextCursor, requestKey]);

  const loadMore = useCallback(
    () => (error === "page" ? Promise.resolve(false) : fetchNextPage()),
    [error, fetchNextPage]
  );

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

  const applyItemPatch = useCallback(
    (screenshotId: string, update: ScreenshotPatch) => {
      ledger.recordWrite(screenshotId, update);
      setItems((current) =>
        current.map((item) =>
          item.id === screenshotId ? applyScreenshotPatch(item, update) : item
        )
      );
    },
    [ledger]
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
    (screenshotId: string, isCountedWhenUnloaded = false) => {
      ledger.recordWrite(screenshotId, null);
      const isLoaded = itemsRef.current.some(
        (item) => item.id === screenshotId
      );
      if (!isLoaded && !isCountedWhenUnloaded) return;

      if (isLoaded) {
        setItems((current) =>
          current.filter((item) => item.id !== screenshotId)
        );
      }
      setTotal((currentTotal) =>
        currentTotal === null ? null : Math.max(0, currentTotal - 1)
      );
    },
    [ledger]
  );

  const removeItem = useCallback(
    (screenshotId: string) => {
      applyItemRemoval(screenshotId);
      publishRef.current?.({ screenshotId, patch: null });
    },
    [applyItemRemoval]
  );

  const removeDeletedItem = useCallback(
    (screenshotId: string) => {
      applyItemRemoval(screenshotId, true);
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
    (screenshotId: string) => ledger.getFetchedAt(screenshotId),
    [ledger]
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
    loadCount,
    retry,
    loadMore,
    refresh,
    updateItem,
    refreshImage,
    imageRefresher,
    subscribeRemoteWrites,
    removeItem,
    removeDeletedItem,
    getFetchedAt,
  };
}
