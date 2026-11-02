import { useCallback, useEffect, useRef, useState } from "react";

import { logger } from "@renderer/logger";
import {
  applyScreenshotPatch,
  isScreenshotSort,
  mergeScreenshotPages,
  ScreenshotFeedLedger,
  type ScreenshotFeedRead,
  type ScreenshotPatch,
} from "@shared";
import type {
  ProfileScreenshot,
  ScreenshotSort,
  ScreenshotsHiddenReason,
} from "@types";

export interface ScreenshotFeedPage {
  items: ProfileScreenshot[];
  nextCursor: string | null;
  total?: number;
  hiddenReason?: ScreenshotsHiddenReason;
}

interface UseScreenshotFeedOptions {
  feedKey: string | null;
  refreshKey?: string | number;
  fetchPage: (cursor: string | null) => Promise<ScreenshotFeedPage | null>;
  fetchScreenshot: (
    screenshot: ProfileScreenshot
  ) => Promise<ProfileScreenshot | null>;
  onServerTotal?: (total: number) => void;
}

export function useScreenshotFeed({
  feedKey,
  refreshKey,
  fetchPage,
  fetchScreenshot,
  onServerTotal,
}: UseScreenshotFeedOptions) {
  const [items, setItems] = useState<ProfileScreenshot[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hiddenReason, setHiddenReason] =
    useState<ScreenshotsHiddenReason>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const [hasLoadMoreFailed, setHasLoadMoreFailed] = useState(false);
  const [loadedRequestId, setLoadedRequestId] = useState(0);
  const requestIdRef = useRef(0);
  const ledgerRef = useRef<ScreenshotFeedLedger | null>(null);
  ledgerRef.current ??= new ScreenshotFeedLedger();
  const ledger = ledgerRef.current;
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const fetchScreenshotRef = useRef(fetchScreenshot);
  fetchScreenshotRef.current = fetchScreenshot;
  const onServerTotalRef = useRef(onServerTotal);
  onServerTotalRef.current = onServerTotal;
  const patchItemRef = useRef<
    (screenshotId: string, patch: ScreenshotPatch) => void
  >(() => undefined);

  const recountItem = useCallback(
    (item: ProfileScreenshot) => {
      const requestId = requestIdRef.current;
      ledger
        .recountComments(item, {
          fetchScreenshot: (screenshot) =>
            fetchScreenshotRef.current(screenshot),
          isCurrent: () => requestId === requestIdRef.current,
          applyPatch: (screenshotId, patch) =>
            patchItemRef.current(screenshotId, patch),
        })
        .catch((error: unknown) => {
          logger.warn("Failed to refresh the screenshot comment count", error);
        });
    },
    [ledger]
  );

  const finishRead = useCallback(
    (page: ScreenshotFeedPage, read: ScreenshotFeedRead) => {
      const merged = ledger.acceptPage(page.items, read);
      merged.recountItems.forEach(recountItem);
      return merged;
    },
    [ledger, recountItem]
  );

  const loadedPageCountRef = useRef(0);

  const readFirstPages = useCallback(async (pageCount: number) => {
    let page = await fetchPageRef.current(null);
    let items = page?.items ?? [];
    let loadedPageCount = 1;
    while (page?.nextCursor && loadedPageCount < pageCount) {
      const nextPage: ScreenshotFeedPage | null = await fetchPageRef.current(
        page.nextCursor
      );
      if (!nextPage) {
        return { page: { ...page, nextCursor: null }, items, loadedPageCount };
      }
      items = mergeScreenshotPages(items, nextPage.items);
      page = nextPage;
      loadedPageCount += 1;
    }
    return { page, items, loadedPageCount };
  }, []);

  const readPages = useCallback(
    async (pageCount: number) => {
      const requestId = ++requestIdRef.current;
      ledger.cancelReads();
      const read = ledger.beginRead();
      const reportServerTotal = onServerTotalRef.current;
      setIsLoading(true);
      setHasFailed(false);
      setHasLoadMoreFailed(false);

      try {
        const { page, items, loadedPageCount } =
          await readFirstPages(pageCount);
        if (requestId !== requestIdRef.current) return;

        const merged = finishRead({ items, nextCursor: null }, read);
        loadedPageCountRef.current = loadedPageCount;
        setItems(merged.items);
        setNextCursor(page?.nextCursor ?? null);
        const mergedTotal =
          page?.total === undefined
            ? null
            : Math.max(0, page.total + merged.netCountDelta);
        setTotal(mergedTotal);
        if (mergedTotal !== null) reportServerTotal?.(mergedTotal);
        setHiddenReason(page?.hiddenReason ?? null);
        setLoadedRequestId(requestId);
      } catch (error) {
        if (requestId !== requestIdRef.current) return;

        logger.error("Failed to load screenshots", error);
        setItems([]);
        setNextCursor(null);
        setTotal(null);
        setHiddenReason(null);
        setHasFailed(true);
      } finally {
        ledger.endRead(read);
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setHasLoaded(true);
        }
      }
    },
    [finishRead, ledger, readFirstPages]
  );

  const reload = useCallback(() => readPages(1), [readPages]);

  const refresh = useCallback(
    () => readPages(Math.max(1, loadedPageCountRef.current)),
    [readPages]
  );

  const loadMore = useCallback(async () => {
    if (ledger.hasPendingReads || !nextCursor) return;

    const requestId = requestIdRef.current;
    const read = ledger.beginRead();
    const reportServerTotal = onServerTotalRef.current;
    setIsLoading(true);
    setHasLoadMoreFailed(false);

    try {
      const page = await fetchPageRef.current(nextCursor);
      if (requestId !== requestIdRef.current || !page) return;

      const merged = finishRead(page, read);
      loadedPageCountRef.current += 1;
      setItems((current) => mergeScreenshotPages(current, merged.items));
      setNextCursor(page.nextCursor);
      const pageTotal = page.total;
      if (pageTotal !== undefined && !merged.hasLaterWrites) {
        setTotal(Math.max(0, pageTotal));
        reportServerTotal?.(Math.max(0, pageTotal));
      }
    } catch (error) {
      if (requestId === requestIdRef.current) {
        logger.error("Failed to load more screenshots", error);
        setHasLoadMoreFailed(true);
      }
    } finally {
      ledger.endRead(read);
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [finishRead, ledger, nextCursor]);

  useEffect(() => {
    requestIdRef.current += 1;
    ledger.reset();
    setItems([]);
    setNextCursor(null);
    setTotal(null);
    setHiddenReason(null);
    loadedPageCountRef.current = 0;
    setHasLoaded(false);
    setHasFailed(false);
    setHasLoadMoreFailed(false);

    if (feedKey === null) {
      setIsLoading(false);
      return;
    }

    void reload();
  }, [feedKey, ledger, reload]);

  const refreshedKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshedKeyRef.current === refreshKey) return;
    refreshedKeyRef.current = refreshKey;
    if (feedKey !== null) void refresh();
  }, [feedKey, refresh, refreshKey]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    []
  );

  const getLatestRequestId = useCallback(() => requestIdRef.current, []);

  const getFetchedAt = useCallback(
    (screenshotId: string) => ledger.getFetchedAt(screenshotId),
    [ledger]
  );

  const patchItem = useCallback(
    (screenshotId: string, patch: ScreenshotPatch) => {
      ledger.recordWrite(screenshotId, patch);
      setItems((current) =>
        current.map((item) =>
          item.id === screenshotId ? applyScreenshotPatch(item, patch) : item
        )
      );
    },
    [ledger]
  );

  patchItemRef.current = patchItem;

  const listedItemsRef = useRef(items);
  listedItemsRef.current = items;

  const removeItem = useCallback(
    (screenshotId: string) => {
      ledger.recordWrite(screenshotId, null);
      const listedItems = listedItemsRef.current;
      if (!listedItems.some((item) => item.id === screenshotId)) return;

      listedItemsRef.current = listedItems.filter(
        (item) => item.id !== screenshotId
      );
      setItems((current) => current.filter((item) => item.id !== screenshotId));
      setTotal((value) => (value === null ? value : Math.max(0, value - 1)));
    },
    [ledger]
  );

  return {
    items,
    total,
    hiddenReason,
    hasMore: nextCursor !== null,
    isLoading,
    hasLoaded,
    hasFailed,
    hasLoadMoreFailed,
    loadedRequestId,
    getLatestRequestId,
    reload,
    loadMore,
    patchItem,
    removeItem,
    getFetchedAt,
  };
}

export const readStoredScreenshotSort = (
  storageKey: string
): ScreenshotSort => {
  try {
    const saved = localStorage.getItem(storageKey);
    return isScreenshotSort(saved) ? saved : "recent";
  } catch {
    return "recent";
  }
};

export const storeScreenshotPreference = (
  storageKey: string,
  value: string
) => {
  try {
    localStorage.setItem(storageKey, value);
  } catch (error) {
    logger.error("Failed to store screenshot preference", error);
  }
};
