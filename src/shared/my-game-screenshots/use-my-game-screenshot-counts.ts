import { useCallback, useEffect, useState } from "react";
import type { GameShop } from "@types";

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
      const [localFiles, published] = await Promise.all([
        local.countLocalScreenshotFiles(shop, objectId),
        countPublishedScreenshotsForGame(
          { shop, objectId },
          userId,
          api,
          local
        ),
      ]);
      setCounts({ local: localFiles, published });
    } catch (error) {
      onError?.(error);
    }
  }, [api, local, objectId, onError, shop, userId]);

  useEffect(() => {
    void refreshCounts();
    const unsubscribeLocal = local.onLocalScreenshotsChange(() => {
      local
        .countLocalScreenshotFiles(shop, objectId)
        .then((localFiles) =>
          setCounts((current) => ({ ...current, local: localFiles }))
        )
        .catch((error) => onError?.(error));
    });
    const unsubscribeChanged = subscribeMyGameScreenshotsChanged(
      () => void refreshCounts()
    );
    return () => {
      unsubscribeLocal();
      unsubscribeChanged();
    };
  }, [local, objectId, onError, refreshCounts, shop]);

  return counts;
}
