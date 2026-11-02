import { useCallback, useEffect, useRef, useState } from "react";
import type { GameShop, LocalScreenshot } from "@types";

import { isLocalScreenshotForGame } from "../local-screenshots";
import {
  countPublishedScreenshotsForGame,
  subscribeMyGameScreenshotsChanged,
  type MyGameScreenshotsApi,
  type MyGameScreenshotsLocalBridge,
} from "./my-game-screenshots";

export interface MyGameScreenshotCounts {
  local: number;
  published: number;
}

interface UseMyGameScreenshotCountsOptions {
  userId: string | null;
  shop: GameShop;
  objectId: string;
  api: MyGameScreenshotsApi;
  local: MyGameScreenshotsLocalBridge;
  onError?: (error: unknown) => void;
}

const getPublishedCopiesKey = (
  screenshots: LocalScreenshot[],
  shop: GameShop,
  objectId: string
) =>
  screenshots
    .flatMap((screenshot) =>
      screenshot.state === "uploaded" &&
      screenshot.screenshotId &&
      isLocalScreenshotForGame(screenshot, shop, objectId)
        ? [screenshot.screenshotId]
        : []
    )
    .toSorted((left, right) => left.localeCompare(right))
    .join(",");

export function useMyGameScreenshotCounts({
  userId,
  shop,
  objectId,
  api,
  local,
  onError,
}: UseMyGameScreenshotCountsOptions) {
  const [counts, setCounts] = useState<MyGameScreenshotCounts>({
    local: 0,
    published: 0,
  });

  const localRequestIdRef = useRef(0);
  const publishedRequestIdRef = useRef(0);

  const refreshLocalCount = useCallback(async () => {
    const requestId = ++localRequestIdRef.current;
    try {
      const localFiles = await local.countLocalScreenshotFiles(shop, objectId);
      if (requestId !== localRequestIdRef.current) return;
      setCounts((current) => ({ ...current, local: localFiles }));
    } catch (error) {
      if (requestId === localRequestIdRef.current) onError?.(error);
    }
  }, [local, objectId, onError, shop]);

  const refreshPublishedCount = useCallback(async () => {
    const requestId = ++publishedRequestIdRef.current;
    try {
      const published = await countPublishedScreenshotsForGame(
        { shop, objectId },
        userId,
        api,
        local
      );
      if (requestId !== publishedRequestIdRef.current) return;
      setCounts((current) => ({ ...current, published }));
    } catch (error) {
      if (requestId !== publishedRequestIdRef.current) return;
      onError?.(error);
      setCounts((current) => ({ ...current, published: 0 }));
    }
  }, [api, local, objectId, onError, shop, userId]);

  const refreshCounts = useCallback(async () => {
    await Promise.all([refreshLocalCount(), refreshPublishedCount()]);
  }, [refreshLocalCount, refreshPublishedCount]);

  useEffect(() => {
    let publishedCopiesKey: string | null = null;

    const handleLocalChange = (screenshots: LocalScreenshot[]) => {
      const nextKey = getPublishedCopiesKey(screenshots, shop, objectId);
      const hasPublishedCopiesChanged = nextKey !== publishedCopiesKey;
      publishedCopiesKey = nextKey;
      void refreshLocalCount();
      if (hasPublishedCopiesChanged) void refreshPublishedCount();
    };

    void refreshCounts();
    const unsubscribeLocal = local.onLocalScreenshotsChange(handleLocalChange);
    const unsubscribeChanged = subscribeMyGameScreenshotsChanged(
      () => void refreshCounts()
    );
    return () => {
      localRequestIdRef.current += 1;
      publishedRequestIdRef.current += 1;
      unsubscribeLocal();
      unsubscribeChanged();
    };
  }, [
    local,
    objectId,
    refreshCounts,
    refreshLocalCount,
    refreshPublishedCount,
    shop,
  ]);

  return counts;
}
