import type {
  GameShop,
  LocalScreenshot,
  ProfileScreenshot,
  ScreenshotSort,
  ScreenshotsResponse,
} from "@types";

import {
  isLocalScreenshotForGame,
  isLocalScreenshotPending,
} from "../local-screenshots";
import { buildUserScreenshotsPath } from "../screenshots";

export interface MyGameScreenshotsTarget {
  shop: GameShop;
  objectId: string;
  isSignedIn?: boolean;
}

export interface MyGameScreenshotsLocalBridge {
  getLocalScreenshotsForGame: (
    shop: GameShop,
    objectId: string
  ) => Promise<LocalScreenshot[]>;
  deleteLocalScreenshotsForGame: (
    shop: GameShop,
    objectId: string
  ) => Promise<number>;
  countLocalScreenshotFiles: (
    shop: GameShop,
    objectId: string
  ) => Promise<number>;
  getPublishedScreenshotIdsForGame: (
    shop: GameShop,
    objectId: string
  ) => Promise<string[]>;
  forgetPublishedScreenshots: (screenshotIds: string[]) => Promise<number>;
  onLocalScreenshotsChange: (
    callback: (screenshots: LocalScreenshot[]) => void
  ) => () => void;
}

export interface MyGameScreenshotsApi {
  get: <T>(path: string) => Promise<T | null | undefined>;
  delete: <T>(path: string) => Promise<T | null | undefined>;
}

export const getLocalScreenshotTitle = (screenshot: LocalScreenshot) =>
  (screenshot.shop === "custom" && screenshot.customGameTitle) ||
  screenshot.gameTitle;

export type MyScreenshotItem =
  | { kind: "published"; id: string; screenshot: ProfileScreenshot }
  | { kind: "local"; id: string; screenshot: LocalScreenshot };

export const mergeMyScreenshots = (
  published: ProfileScreenshot[],
  local: LocalScreenshot[],
  sort: ScreenshotSort
): MyScreenshotItem[] => {
  const localItems: MyScreenshotItem[] = local.map((screenshot) => ({
    kind: "local",
    id: `local:${screenshot.clientId}`,
    screenshot,
  }));
  const publishedItems: MyScreenshotItem[] = published.map((screenshot) => ({
    kind: "published",
    id: screenshot.id,
    screenshot,
  }));

  if (sort === "top") return [...localItems, ...publishedItems];

  return [...localItems, ...publishedItems].toSorted(
    (a, b) => b.screenshot.capturedAt - a.screenshot.capturedAt
  );
};

export const selectPendingLocalWithinLoadedUploads = (
  pendingLocal: LocalScreenshot[],
  loadedUploads: ProfileScreenshot[],
  hasMoreUploads: boolean
) => {
  const oldestLoadedUpload = loadedUploads.at(-1)?.capturedAt;
  if (!hasMoreUploads || oldestLoadedUpload === undefined) return pendingLocal;

  return pendingLocal.filter(
    (screenshot) => screenshot.capturedAt >= oldestLoadedUpload
  );
};

export const selectPendingLocalScreenshots = (
  screenshots: LocalScreenshot[],
  { shop, objectId }: MyGameScreenshotsTarget
) =>
  screenshots
    .filter(
      (screenshot) =>
        isLocalScreenshotForGame(screenshot, shop, objectId) &&
        isLocalScreenshotPending(screenshot)
    )
    .toSorted((a, b) => b.capturedAt - a.capturedAt);

export const countPublishedScreenshotsForGame = async (
  { shop, objectId }: MyGameScreenshotsTarget,
  userId: string | null,
  api: MyGameScreenshotsApi,
  local: MyGameScreenshotsLocalBridge
) => {
  if (!userId) return 0;
  if (shop === "custom") {
    return (await local.getPublishedScreenshotIdsForGame(shop, objectId))
      .length;
  }

  const response = await api.get<ScreenshotsResponse>(
    buildUserScreenshotsPath({ userId, take: 1, shop, objectId })
  );
  return response?.total ?? response?.items.length ?? 0;
};

type ChangeListener = () => void;

const changeListeners = new Set<ChangeListener>();

export const subscribeMyGameScreenshotsChanged = (listener: ChangeListener) => {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
};

export const notifyMyGameScreenshotsChanged = () => {
  for (const listener of changeListeners) listener();
};

export type MyGameScreenshotsStatus =
  | "loading"
  | "failed"
  | "partial"
  | "ready";

interface MyGameScreenshotsSourceState {
  isLoaded: boolean;
  hasFailed: boolean;
}

export const resolveMyGameScreenshotsStatus = ({
  local,
  published,
}: {
  local: MyGameScreenshotsSourceState;
  published: MyGameScreenshotsSourceState & { isEnabled: boolean };
}): MyGameScreenshotsStatus => {
  const publishedFailed = published.isEnabled && published.hasFailed;
  const publishedReady =
    !published.isEnabled || (published.isLoaded && !published.hasFailed);
  const localReady = local.isLoaded && !local.hasFailed;

  if (local.hasFailed && (!published.isEnabled || publishedFailed)) {
    return "failed";
  }
  if (local.hasFailed) return publishedReady ? "partial" : "loading";
  if (publishedFailed) return localReady ? "partial" : "loading";
  if (localReady && publishedReady) return "ready";
  return "loading";
};

export function createLocalSnapshotGuard() {
  let version = 0;

  return {
    beginRead: () => version,
    isCurrentRead: (startedAt: number) => startedAt === version,
    noteSnapshot: () => {
      version += 1;
    },
  };
}
