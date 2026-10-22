import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameShop, LocalScreenshot, ScreenshotSort } from "@types";
import {
  buildUserScreenshotsPath,
  isLocalScreenshotForGame,
  mergeMyScreenshots,
  selectPendingLocalScreenshots,
  subscribeMyGameScreenshotsChanged,
  type ScreenshotWriteBus,
} from "@shared";
import { logger } from "@renderer/logger";
import { myGameScreenshotsLocal } from "@renderer/pages/game-details/game-screenshots/my-game-screenshots-bridge";

import { useUserDetails } from "../../../../hooks";
import { useScreenshotFeed } from "../../screenshots";

interface UseMyGameScreenshotsOptions {
  shop: GameShop;
  objectId: string;
  sort: ScreenshotSort;
  take: number;
  isEnabled: boolean;
  writeBus?: ScreenshotWriteBus;
  feedKeySuffix: string;
}

function usePendingLocalScreenshots(
  shop: GameShop,
  objectId: string,
  isEnabled: boolean
) {
  const [screenshots, setScreenshots] = useState<LocalScreenshot[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = useCallback(() => {
    return myGameScreenshotsLocal
      .getLocalScreenshotsForGame(shop, objectId)
      .then((items) => {
        setScreenshots(items);
        setHasLoaded(true);
      })
      .catch((error: unknown) => {
        logger.error("Failed to load local screenshots for the game", error);
        setHasLoaded(true);
      });
  }, [objectId, shop]);

  useEffect(() => {
    if (!isEnabled) return;
    let isCurrent = true;

    const loadIfCurrent = () => {
      if (isCurrent) void load();
    };

    loadIfCurrent();
    const unsubscribeLocal =
      globalThis.window.electron.onLocalScreenshotsChange((items) => {
        if (!isCurrent) return;
        setScreenshots(
          items.filter((item) => isLocalScreenshotForGame(item, shop, objectId))
        );
      });
    const unsubscribeProgress =
      globalThis.window.electron.onScreenshotUploadProgress((progress) => {
        if (!isCurrent) return;
        setScreenshots((current) =>
          current.map((item) =>
            item.clientId === progress.clientId
              ? { ...item, state: progress.state }
              : item
          )
        );
      });

    return () => {
      isCurrent = false;
      unsubscribeLocal();
      unsubscribeProgress();
    };
  }, [isEnabled, load, objectId, shop]);

  const pending = useMemo(
    () => selectPendingLocalScreenshots(screenshots, { shop, objectId }),
    [objectId, screenshots, shop]
  );

  return { pending, hasLoaded, reload: load };
}

export function useMyGameScreenshots({
  shop,
  objectId,
  sort,
  take,
  isEnabled,
  writeBus,
  feedKeySuffix,
}: UseMyGameScreenshotsOptions) {
  const { userDetails } = useUserDetails();
  const userId = userDetails?.id ?? null;
  const canFetchPublished = Boolean(userId) && shop !== "custom";
  const local = usePendingLocalScreenshots(shop, objectId, isEnabled);

  const buildPath = useCallback(
    (cursor: string | null) =>
      buildUserScreenshotsPath({
        userId: userId ?? "",
        cursor,
        take,
        sort,
        shop,
        objectId,
      }),
    [objectId, shop, sort, take, userId]
  );

  const feed = useScreenshotFeed({
    requestKey:
      isEnabled && canFetchPublished
        ? [userId, shop, objectId, sort, take, feedKeySuffix].join(":")
        : null,
    buildPath,
    needsAuth: true,
    writeBus,
  });
  const { refresh } = feed;
  const reloadLocal = local.reload;

  const pendingIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const currentIds = local.pending.map((item) => item.clientId);
    const hasSettled = pendingIdsRef.current.some(
      (clientId) => !currentIds.includes(clientId)
    );
    pendingIdsRef.current = currentIds;
    if (hasSettled) refresh();
  }, [local.pending, refresh]);

  useEffect(() => {
    if (!isEnabled) return;
    return subscribeMyGameScreenshotsChanged(() => {
      void reloadLocal();
      refresh();
    });
  }, [isEnabled, refresh, reloadLocal]);

  const items = useMemo(
    () => mergeMyScreenshots(feed.items, local.pending, sort),
    [feed.items, local.pending, sort]
  );

  const hasLoaded =
    local.hasLoaded &&
    (!canFetchPublished || !feed.isLoading || feed.error === "initial");

  return {
    feed,
    pendingLocal: local.pending,
    items,
    hasLoaded,
    canFetchPublished,
  };
}

export type MyGameScreenshots = ReturnType<typeof useMyGameScreenshots>;
