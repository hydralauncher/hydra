import fs from "node:fs";
import type { GameShop, LocalScreenshot } from "@types";

import { logger } from "../logger";
import {
  isLocalScreenshotForGame,
  isPublishedLocalScreenshot,
} from "./local-screenshot-game";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { ScreenshotReviewWindows } from "./screenshot-review-windows";
import { ScreenshotTelemetry } from "./screenshot-telemetry";
import { screenshotUploadWorker } from "./screenshot-upload-worker";

const removeLocalScreenshot = async (
  clientId: string,
  shouldDelete: (screenshot: LocalScreenshot) => boolean = () => true
) => {
  const screenshot = await LocalScreenshotStore.get(clientId);
  if (!screenshot || screenshot.state === "deleted") return false;
  if (!shouldDelete(screenshot)) return false;

  screenshotUploadWorker.cancel(clientId);
  await fs.promises.rm(screenshot.path, { force: true });
  if (isPublishedLocalScreenshot(screenshot)) {
    await LocalScreenshotStore.update(clientId, {
      state: "deleted",
      uploadProgress: null,
    });
  } else {
    await LocalScreenshotStore.delete(clientId);
  }
  ScreenshotReviewWindows.removeScreenshotFromWindows(clientId);
  ScreenshotTelemetry.record("review", "delete");
  return true;
};

export const deleteLocalScreenshot = async (clientId: string) => {
  await removeLocalScreenshot(clientId);
};

export const deleteLocalScreenshotsForGame = async (
  shop: GameShop,
  objectId: string
) => {
  const screenshots = await LocalScreenshotStore.listForGame(shop, objectId);
  const results = await Promise.allSettled(
    screenshots.map((screenshot) =>
      removeLocalScreenshot(screenshot.clientId, (current) =>
        isLocalScreenshotForGame(current, shop, objectId)
      )
    )
  );

  let deleted = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      if (result.value) deleted += 1;
    } else {
      logger.error("Failed to delete a local screenshot", result.reason);
    }
  }
  return deleted;
};
