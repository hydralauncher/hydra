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

export const selectUploadedScreenshotIds = (
  screenshots: LocalScreenshot[],
  shop: GameShop,
  objectId: string
) =>
  screenshots
    .filter(
      (screenshot) =>
        isLocalScreenshotForGame(screenshot, shop, objectId) &&
        screenshot.state === "uploaded" &&
        screenshot.screenshotId
    )
    .map((screenshot) => screenshot.screenshotId as string);

export const loadLocalScreenshotsForGame = async (
  shop: GameShop,
  objectId: string
) => {
  const screenshots = await window.electron.getLocalScreenshots();
  return screenshots.filter((screenshot) =>
    isLocalScreenshotForGame(screenshot, shop, objectId)
  );
};

export const deleteLocalScreenshotsForGame = async (
  shop: GameShop,
  objectId: string
) => {
  const screenshots = await loadLocalScreenshotsForGame(shop, objectId);
  const pending = selectPendingLocalScreenshots(screenshots, shop, objectId);
  let deleted = 0;

  for (const screenshot of pending) {
    await window.electron.deleteLocalScreenshot(screenshot.clientId);
    deleted += 1;
  }

  return deleted;
};

export const getPublishedScreenshotIdsForGame = async (
  shop: GameShop,
  objectId: string
) =>
  selectUploadedScreenshotIds(
    await loadLocalScreenshotsForGame(shop, objectId),
    shop,
    objectId
  );
