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
  const requestIdRef = useRef(0);
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setHasFailed(false);

    try {
      const page = await fetchPageRef.current(null);
      if (requestId !== requestIdRef.current) return;

      setItems(page?.items ?? []);
      setNextCursor(page?.nextCursor ?? null);
      setTotal(page?.total ?? null);
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
        setIsLoading(false);
        setHasLoaded(true);
      }
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (isLoading || !nextCursor) return;

    const requestId = requestIdRef.current;
    setIsLoading(true);

    try {
      const page = await fetchPageRef.current(nextCursor);
      if (requestId !== requestIdRef.current || !page) return;

      setItems((current) => mergeScreenshotPages(current, page.items));
      setNextCursor(page.nextCursor);
      if (page.total !== undefined) setTotal(page.total);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        logger.error("Failed to load more screenshots", error);
        setNextCursor(null);
      }
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [isLoading, nextCursor]);

  useEffect(() => {
    requestIdRef.current += 1;
    setItems([]);
    setNextCursor(null);
    setTotal(null);
    setHiddenReason(null);
    setHasLoaded(false);
    setHasFailed(false);

    if (feedKey === null) {
      setIsLoading(false);
      return;
    }

    void reload();
  }, [feedKey, reload]);

  const patchItem = useCallback(
    (screenshotId: string, patch: Partial<ProfileScreenshot>) => {
      setItems((current) =>
        current.map((item) =>
          item.id === screenshotId ? { ...item, ...patch } : item
        )
      );
    },
    []
  );

  const removeItem = useCallback((screenshotId: string) => {
    setItems((current) => current.filter((item) => item.id !== screenshotId));
    setTotal((value) => (value === null ? value : Math.max(0, value - 1)));
  }, []);

  return {
    items,
    total,
    hiddenReason,
    hasMore: nextCursor !== null,
    isLoading,
    hasLoaded,
    hasFailed,
    reload,
    loadMore,
    patchItem,
    removeItem,
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
