import { useCallback, useEffect, useRef, useState } from "react";

import { logger } from "@renderer/logger";
import {
  applyScreenshotFeedWrites,
  applyScreenshotPatch,
  isRelativeScreenshotPatch,
  isScreenshotSort,
  mergeScreenshotPages,
  type ScreenshotFeedWrite,
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

const getReadStartedAt = () => performance.now();

interface UseScreenshotFeedOptions {
  feedKey: string | null;
  fetchPage: (cursor: string | null) => Promise<ScreenshotFeedPage | null>;
  fetchScreenshot: (
    screenshot: ProfileScreenshot
  ) => Promise<ProfileScreenshot | null>;
}

export function useScreenshotFeed({
  feedKey,
  fetchPage,
  fetchScreenshot,
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
  const lastRelativeWriteRef = useRef(new Map<string, number>());
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const fetchScreenshotRef = useRef(fetchScreenshot);
  fetchScreenshotRef.current = fetchScreenshot;
  const patchItemRef = useRef<
    (screenshotId: string, patch: ScreenshotPatch) => void
  >(() => undefined);

  const recountItem = useCallback(async (item: ProfileScreenshot) => {
    const requestId = requestIdRef.current;
    const startedVersion = writeVersionRef.current;

    try {
      const fresh = await fetchScreenshotRef.current(item);
      if (!fresh || requestId !== requestIdRef.current) return;

      const lastRelativeWrite = lastRelativeWriteRef.current.get(item.id) ?? 0;
      if (lastRelativeWrite > startedVersion) {
        void recountItem(item);
        return;
      }

      patchItemRef.current(item.id, { commentCount: fresh.commentCount });
    } catch (error) {
      logger.warn("Failed to refresh the screenshot comment count", error);
    }
  }, []);

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
      const merged = applyScreenshotFeedWrites(
        page.items,
        writesRef.current,
        sinceVersion
      );
      writesRef.current = [];
      recordFetchedItems(merged.items, startedAt);
      for (const item of merged.items) {
        if (merged.recountIds.has(item.id)) void recountItem(item);
      }
      return merged;
    },
    [recordFetchedItems, recountItem]
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
          : Math.max(0, page.total + merged.netCountDelta)
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
          merged.hasLaterWrites ? current : Math.max(0, pageTotal)
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
    lastRelativeWriteRef.current.clear();
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
    (screenshotId: string, patch: ScreenshotPatch | null) => {
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
    (screenshotId: string, patch: ScreenshotPatch) => {
      recordWrite(screenshotId, patch);
      if (isRelativeScreenshotPatch(patch)) {
        lastRelativeWriteRef.current.set(screenshotId, writeVersionRef.current);
      }
      setItems((current) =>
        current.map((item) =>
          item.id === screenshotId ? applyScreenshotPatch(item, patch) : item
        )
      );
    },
    [recordWrite]
  );

  patchItemRef.current = patchItem;

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
