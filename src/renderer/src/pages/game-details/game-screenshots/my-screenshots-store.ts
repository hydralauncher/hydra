import { isLocalScreenshotForGame, isLocalScreenshotPending } from "@shared";
import type {
  GameShop,
  LocalScreenshot,
  ProfileScreenshot,
  ScreenshotSort,
} from "@types";

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

type ChangeListener = () => void;

const listeners = new Set<ChangeListener>();

export const subscribeMyScreenshotsChanged = (listener: ChangeListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const notifyMyScreenshotsChanged = () => {
  for (const listener of listeners) listener();
};

const sortNewestFirst = (screenshots: LocalScreenshot[]) =>
  screenshots.toSorted((a, b) => b.capturedAt - a.capturedAt);

export const selectPendingLocalScreenshots = (
  screenshots: LocalScreenshot[],
  shop: GameShop,
  objectId: string
) =>
  sortNewestFirst(
    screenshots.filter(
      (screenshot) =>
        isLocalScreenshotForGame(screenshot, shop, objectId) &&
        isLocalScreenshotPending(screenshot)
    )
  );

export const loadLocalScreenshotsForGame = (shop: GameShop, objectId: string) =>
  window.electron.getLocalScreenshotsForGame(shop, objectId);

export const deleteLocalScreenshotsForGame = (
  shop: GameShop,
  objectId: string
) => window.electron.deleteLocalScreenshotsForGame(shop, objectId);

export const getPublishedScreenshotIdsForGame = (
  shop: GameShop,
  objectId: string
) => window.electron.getPublishedScreenshotIdsForGame(shop, objectId);
