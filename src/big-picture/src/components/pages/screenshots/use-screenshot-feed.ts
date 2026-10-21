import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileScreenshot, ScreenshotsHiddenReason } from "@types";
import { mergeScreenshotPages } from "@shared";
import { logger } from "@renderer/logger";

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
}

export function useScreenshotFeed({
  requestKey,
  buildPath,
  needsAuth,
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

  const itemsRef = useRef(items);

  buildPathRef.current = buildPath;
  itemsRef.current = items;

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    isLoadingMoreRef.current = false;
    setIsLoadingMore(false);
    setItems([]);
    setTotal(null);
    setHiddenReason(null);
    setNextCursor(null);
    setLoadedKey(null);
    setError(null);

    if (!requestKey) return;

    globalThis.window.electron.hydraApi
      .get<ScreenshotFeedResponse | null>(buildPathRef.current(null), {
        needsAuth,
      })
      .then((response) => {
        if (generationRef.current !== generation) return;

        setItems(response?.items ?? []);
        setTotal(typeof response?.total === "number" ? response.total : null);
        setHiddenReason(response?.hiddenReason ?? null);
        setNextCursor(response?.nextCursor ?? null);
      })
      .catch((error: unknown) => {
        if (generationRef.current !== generation) return;

        logger.error("Failed to load screenshots", error);
        setError("initial");
      })
      .finally(() => {
        if (generationRef.current !== generation) return;

        setLoadedKey(requestKey);
      });
  }, [needsAuth, refreshToken, requestKey]);

  const fetchNextPage = useCallback(async () => {
    if (!requestKey || !nextCursor || isLoadingMoreRef.current) return;

    const generation = generationRef.current;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const response =
        await globalThis.window.electron.hydraApi.get<ScreenshotFeedResponse | null>(
          buildPathRef.current(nextCursor),
          { needsAuth }
        );

      if (generationRef.current !== generation) return;

      setItems((current) =>
        mergeScreenshotPages(current, response?.items ?? [])
      );
      if (typeof response?.total === "number") setTotal(response.total);
      setNextCursor(response?.nextCursor ?? null);
    } catch (loadError) {
      logger.error("Failed to load more screenshots", loadError);
      if (generationRef.current === generation) setError("page");
    } finally {
      if (generationRef.current === generation) {
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

  const updateItem = useCallback(
    (screenshotId: string, update: Partial<ProfileScreenshot>) => {
      setItems((current) =>
        current.map((item) =>
          item.id === screenshotId ? { ...item, ...update } : item
        )
      );
    },
    []
  );

  const removeItem = useCallback((screenshotId: string) => {
    if (!itemsRef.current.some((item) => item.id === screenshotId)) return;

    setItems((current) => current.filter((item) => item.id !== screenshotId));
    setTotal((currentTotal) =>
      currentTotal === null ? null : Math.max(0, currentTotal - 1)
    );
  }, []);

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
    removeItem,
  };
}
