import type {
  Game,
  GameShop,
  LocalScreenshot,
  LocalScreenshotState,
} from "@types";

const GAME_PAGE_STATES = new Set<LocalScreenshotState>([
  "local",
  "failed",
  "reviewing",
]);

export const isLocalScreenshotForGame = (
  screenshot: LocalScreenshot,
  shop: GameShop,
  objectId: string
) =>
  screenshot.shop === shop &&
  screenshot.objectId === objectId &&
  GAME_PAGE_STATES.has(screenshot.state);

export const isLocalScreenshotFileForGame = (
  screenshot: LocalScreenshot,
  shop: GameShop,
  objectId: string
) =>
  isLocalScreenshotForGame(screenshot, shop, objectId) ||
  (screenshot.shop === shop &&
    screenshot.objectId === objectId &&
    screenshot.state === "uploaded");

export const isPublishedLocalScreenshot = (screenshot: LocalScreenshot) =>
  screenshot.state === "uploaded" && Boolean(screenshot.screenshotId);

export const getPublishedScreenshotIds = (
  screenshots: LocalScreenshot[],
  shop: GameShop,
  objectId: string,
  ownerId: string
) => [
  ...new Set(
    screenshots.flatMap((screenshot) =>
      screenshot.screenshotId &&
      screenshot.shop === shop &&
      screenshot.objectId === objectId &&
      screenshot.ownerId === ownerId &&
      (screenshot.state === "uploaded" || screenshot.state === "deleted")
        ? [screenshot.screenshotId]
        : []
    )
  ),
];

export const findLocalScreenshotGameObjectId = (
  screenshot: LocalScreenshot,
  games: Game[]
) => {
  if (screenshot.objectId) return null;

  const matches = games.filter(
    (game) =>
      !game.isDeleted &&
      game.shop === screenshot.shop &&
      game.title === screenshot.gameTitle
  );
  return matches.length === 1 ? matches[0].objectId : null;
};
