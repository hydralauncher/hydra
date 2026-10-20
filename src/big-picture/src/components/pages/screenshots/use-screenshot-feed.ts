import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileScreenshot, ScreenshotsHiddenReason } from "@types";
import { logger } from "@renderer/logger";

interface ScreenshotFeedResponse {
  items?: ProfileScreenshot[] | null;
  total?: number;
  hiddenReason?: ScreenshotsHiddenReason;
  nextCursor?: string | null;
}

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
      })
      .finally(() => {
        if (generationRef.current !== generation) return;

        setLoadedKey(requestKey);
      });
  }, [needsAuth, refreshToken, requestKey]);

  const loadMore = useCallback(async () => {
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

      setItems((current) => {
        const knownIds = new Set(current.map((item) => item.id));
        const nextItems = (response?.items ?? []).filter(
          (item) => !knownIds.has(item.id)
        );

        return [...current, ...nextItems];
      });
      if (typeof response?.total === "number") setTotal(response.total);
      setNextCursor(response?.nextCursor ?? null);
    } catch (error) {
      logger.error("Failed to load more screenshots", error);
    } finally {
      if (generationRef.current === generation) {
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [needsAuth, nextCursor, requestKey]);

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

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
    loadMore,
    refresh,
    updateItem,
    removeItem,
  };
}
