import { useCallback, useEffect, useState } from "react";
import type { GameShop } from "@types";

import { isLocalScreenshotForGame } from "../local-screenshots";
import {
  countPublishedScreenshotsForGame,
  selectPendingLocalScreenshots,
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

  const refreshCounts = useCallback(async () => {
    try {
      const [localScreenshots, published] = await Promise.all([
        local.getLocalScreenshotsForGame(shop, objectId),
        countPublishedScreenshotsForGame(
          { shop, objectId },
          userId,
          api,
          local
        ),
      ]);
      setCounts({
        local: selectPendingLocalScreenshots(localScreenshots, {
          shop,
          objectId,
        }).length,
        published,
      });
    } catch (error) {
      onError?.(error);
    }
  }, [api, local, objectId, onError, shop, userId]);

  useEffect(() => {
    void refreshCounts();
    const unsubscribeLocal = local.onLocalScreenshotsChange((screenshots) => {
      const pending = selectPendingLocalScreenshots(
        screenshots.filter((screenshot) =>
          isLocalScreenshotForGame(screenshot, shop, objectId)
        ),
        { shop, objectId }
      ).length;
      setCounts((current) => ({ ...current, local: pending }));
    });
    const unsubscribeChanged = subscribeMyGameScreenshotsChanged(
      () => void refreshCounts()
    );
    return () => {
      unsubscribeLocal();
      unsubscribeChanged();
    };
  }, [local, objectId, refreshCounts, shop]);

  return counts;
}
