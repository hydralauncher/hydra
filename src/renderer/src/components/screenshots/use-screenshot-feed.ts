import { useCallback, useEffect, useRef, useState } from "react";

import { logger } from "@renderer/logger";
import { isScreenshotSort, mergeScreenshotPages } from "@shared";
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

interface ScreenshotFeedWrite {
  version: number;
  screenshotId: string;
  patch: Partial<ProfileScreenshot> | null;
}

const applyWritesSince = (
  items: ProfileScreenshot[],
  writes: ScreenshotFeedWrite[],
  sinceVersion: number
) => {
  let result = items;
  let removedCount = 0;
  let hasRemovals = false;

  for (const write of writes) {
    if (write.version <= sinceVersion) continue;

    if (write.patch === null) {
      hasRemovals = true;
      const next = result.filter((item) => item.id !== write.screenshotId);
      removedCount += result.length - next.length;
      result = next;
    } else {
      const { patch } = write;
      result = result.map((item) =>
        item.id === write.screenshotId ? { ...item, ...patch } : item
      );
    }
  }

  return { items: result, removedCount, hasRemovals };
};

const getReadStartedAt = () => performance.now();

interface UseScreenshotFeedOptions {
  feedKey: string | null;
  fetchPage: (cursor: string | null) => Promise<ScreenshotFeedPage | null>;
}

export function useScreenshotFeed({
  feedKey,
  fetchPage,
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
  const requestIdRef = useRef(0);
  const writeVersionRef = useRef(0);
  const writesRef = useRef<ScreenshotFeedWrite[]>([]);
  const isReadPendingRef = useRef(false);
  const fetchedAtRef = useRef(new Map<string, number>());
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  const recordFetchedItems = useCallback(
    (fetchedItems: ProfileScreenshot[], startedAt: number) => {
      for (const item of fetchedItems) {
        fetchedAtRef.current.set(item.id, startedAt);
      }
    },
    []
  );

  const finishRead = useCallback(
    (page: ScreenshotFeedPage, sinceVersion: number, startedAt: number) => {
      const merged = applyWritesSince(
        page.items,
        writesRef.current,
        sinceVersion
      );
      writesRef.current = [];
      recordFetchedItems(merged.items, startedAt);
      return merged;
    },
    [recordFetchedItems]
  );

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const sinceVersion = writeVersionRef.current;
    const startedAt = getReadStartedAt();
    isReadPendingRef.current = true;
    setIsLoading(true);
    setHasFailed(false);
    setHasLoadMoreFailed(false);

    try {
      const page = await fetchPageRef.current(null);
      if (requestId !== requestIdRef.current) return;

      const merged = finishRead(
        page ?? { items: [], nextCursor: null },
        sinceVersion,
        startedAt
      );
      setItems(merged.items);
      setNextCursor(page?.nextCursor ?? null);
      setTotal(
        page?.total === undefined
          ? null
          : Math.max(0, page.total - merged.removedCount)
      );
      setHiddenReason(page?.hiddenReason ?? null);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;

      logger.error("Failed to load screenshots", error);
      setItems([]);
      setNextCursor(null);
      setTotal(null);
      setHiddenReason(null);
      setHasFailed(true);
    } finally {
      if (requestId === requestIdRef.current) {
        isReadPendingRef.current = false;
        setIsLoading(false);
        setHasLoaded(true);
      }
    }
  }, [finishRead]);

  const loadMore = useCallback(async () => {
    if (isLoading || !nextCursor) return;

    const requestId = requestIdRef.current;
    const sinceVersion = writeVersionRef.current;
    const startedAt = getReadStartedAt();
    isReadPendingRef.current = true;
    setIsLoading(true);
    setHasLoadMoreFailed(false);

    try {
      const page = await fetchPageRef.current(nextCursor);
      if (requestId !== requestIdRef.current || !page) return;

      const merged = finishRead(page, sinceVersion, startedAt);
      setItems((current) => mergeScreenshotPages(current, merged.items));
      setNextCursor(page.nextCursor);
      const pageTotal = page.total;
      if (pageTotal !== undefined) {
        setTotal((current) =>
          merged.hasRemovals ? current : Math.max(0, pageTotal)
        );
      }
    } catch (error) {
      if (requestId === requestIdRef.current) {
        logger.error("Failed to load more screenshots", error);
        setHasLoadMoreFailed(true);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        isReadPendingRef.current = false;
        setIsLoading(false);
      }
    }
  }, [finishRead, isLoading, nextCursor]);

  useEffect(() => {
    requestIdRef.current += 1;
    isReadPendingRef.current = false;
    writesRef.current = [];
    fetchedAtRef.current.clear();
    setItems([]);
    setNextCursor(null);
    setTotal(null);
    setHiddenReason(null);
    setHasLoaded(false);
    setHasFailed(false);
    setHasLoadMoreFailed(false);

    if (feedKey === null) {
      setIsLoading(false);
      return;
    }

    void reload();
  }, [feedKey, reload]);

  const recordWrite = useCallback(
    (screenshotId: string, patch: Partial<ProfileScreenshot> | null) => {
      writeVersionRef.current += 1;
      if (!isReadPendingRef.current) return;

      writesRef.current.push({
        version: writeVersionRef.current,
        screenshotId,
        patch,
      });
    },
    []
  );

  const getFetchedAt = useCallback(
    (screenshotId: string) => fetchedAtRef.current.get(screenshotId) ?? null,
    []
  );

  const patchItem = useCallback(
    (screenshotId: string, patch: Partial<ProfileScreenshot>) => {
      recordWrite(screenshotId, patch);
      setItems((current) =>
        current.map((item) =>
          item.id === screenshotId ? { ...item, ...patch } : item
        )
      );
    },
    [recordWrite]
  );

  const removeItem = useCallback(
    (screenshotId: string) => {
      recordWrite(screenshotId, null);
      fetchedAtRef.current.delete(screenshotId);
      setItems((current) => current.filter((item) => item.id !== screenshotId));
      setTotal((value) => (value === null ? value : Math.max(0, value - 1)));
    },
    [recordWrite]
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
