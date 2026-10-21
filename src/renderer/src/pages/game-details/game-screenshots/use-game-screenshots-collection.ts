import { useCallback } from "react";

import {
  useScreenshotCollection,
  type ScreenshotFeedPage,
} from "@renderer/components/screenshots";
import { useUserDetails } from "@renderer/hooks";
import { buildGameScreenshotsPath, type ScreenshotWriteBus } from "@shared";
import type { GameScreenshotsResponse, GameShop, ScreenshotSort } from "@types";

interface UseGameScreenshotsCollectionOptions {
  shop: GameShop;
  objectId: string;
  sort: ScreenshotSort;
  take: number;
  isEnabled: boolean;
  writeBus: ScreenshotWriteBus;
}

export function useGameScreenshotsCollection({
  shop,
  objectId,
  sort,
  take,
  isEnabled,
  writeBus,
}: UseGameScreenshotsCollectionOptions) {
  const { userDetails } = useUserDetails();
  const viewerId = userDetails?.id ?? null;

  const fetchPage = useCallback(
    async (cursor: string | null): Promise<ScreenshotFeedPage | null> => {
      const response =
        await window.electron.hydraApi.get<GameScreenshotsResponse>(
          buildGameScreenshotsPath({ shop, objectId, cursor, sort, take }),
          { needsAuth: Boolean(viewerId) }
        );

      return response ?? null;
    },
    [objectId, shop, sort, take, viewerId]
  );

  return useScreenshotCollection({
    feedKey: isEnabled
      ? [shop, objectId, sort, take, viewerId].join(":")
      : null,
    fetchPage,
    writeBus,
  });
}
