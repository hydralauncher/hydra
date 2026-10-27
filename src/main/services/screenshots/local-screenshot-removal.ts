import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { GameShop, LocalScreenshot } from "@types";

import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import {
  isLocalScreenshotFileForGame,
  isPublishedLocalScreenshot,
} from "./local-screenshot-game";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { removeScreenshotPreview } from "./screenshot-preview";
import { ScreenshotTelemetry } from "./screenshot-telemetry";
import { screenshotUploadWorker } from "./screenshot-upload-worker";

const fileExists = (filePath: string) =>
  fs.promises.access(filePath).then(
    () => true,
    () => false
  );

const removeLocalScreenshot = async (
  clientId: string,
  shouldDelete: (screenshot: LocalScreenshot) => boolean = () => true,
  telemetryOutcome = "delete"
) => {
  const screenshot = await LocalScreenshotStore.get(clientId);
  if (!screenshot || screenshot.state === "deleted") return false;
  if (!shouldDelete(screenshot)) return false;

  screenshotUploadWorker.cancel(clientId);
  await fs.promises.rm(screenshot.path, { force: true });
  await removeScreenshotPreview(screenshot.previewPath);
  if (isPublishedLocalScreenshot(screenshot)) {
    await LocalScreenshotStore.update(clientId, {
      state: "deleted",
      uploadProgress: null,
      previewPath: null,
    });
  } else {
    await LocalScreenshotStore.delete(clientId);
  }
  ScreenshotTelemetry.record("review", telemetryOutcome);
  return true;
};

export const deleteLocalScreenshot = async (clientId: string) => {
  await removeLocalScreenshot(clientId);
};

const isUnpublishedLocalFile = (screenshot: LocalScreenshot) =>
  screenshot.state !== "uploaded" && screenshot.state !== "deleted";

const pendingMissingRemovals = new Map<string, Promise<boolean>>();

const removeMissingLocalScreenshot = async (clientId: string) => {
  const pending = pendingMissingRemovals.get(clientId);
  if (pending) {
    await pending;
    return false;
  }

  const removal = removeLocalScreenshot(
    clientId,
    isUnpublishedLocalFile,
    "missing_file"
  ).finally(() => pendingMissingRemovals.delete(clientId));
  pendingMissingRemovals.set(clientId, removal);
  return removal;
};

const announceMissingLocalScreenshots = (count: number) => {
  if (count === 0) return;
  WindowManager.sendToAppWindows("on-local-screenshots-missing", count);
};

export const pruneMissingLocalScreenshots = async (
  screenshots: LocalScreenshot[]
) => {
  const isPresent = await Promise.all(
    screenshots.map(
      (screenshot) =>
        !isUnpublishedLocalFile(screenshot) || fileExists(screenshot.path)
    )
  );
  const missing = screenshots.filter((_, index) => !isPresent[index]);
  if (!missing.length) return screenshots;

  const removed = await Promise.all(
    missing.map((screenshot) =>
      removeMissingLocalScreenshot(screenshot.clientId)
    )
  );
  announceMissingLocalScreenshots(removed.filter(Boolean).length);
  return screenshots.filter((_, index) => isPresent[index]);
};

export const removeLocalScreenshotIfMissing = async (clientId: string) => {
  const screenshot = await LocalScreenshotStore.get(clientId);
  if (!screenshot || !isUnpublishedLocalFile(screenshot)) return false;
  if (await fileExists(screenshot.path)) return false;

  const removed = await removeMissingLocalScreenshot(clientId);
  if (removed) announceMissingLocalScreenshots(1);
  return removed;
};

const listLocalScreenshotFilesForGame = async (
  shop: GameShop,
  objectId: string
) => {
  const screenshots = await LocalScreenshotStore.list();
  const candidates = screenshots.filter((screenshot) =>
    isLocalScreenshotFileForGame(screenshot, shop, objectId)
  );
  const hasFile = await Promise.all(
    candidates.map(
      (screenshot) =>
        screenshot.state !== "uploaded" || fileExists(screenshot.path)
    )
  );
  return candidates.filter((_, index) => hasFile[index]);
};

export const countLocalScreenshotFilesForGame = async (
  shop: GameShop,
  objectId: string
) => (await listLocalScreenshotFilesForGame(shop, objectId)).length;

export const deleteLocalScreenshotsForGame = async (
  shop: GameShop,
  objectId: string
) => {
  const screenshots = await listLocalScreenshotFilesForGame(shop, objectId);
  const results = await Promise.allSettled(
    screenshots.map((screenshot) =>
      removeLocalScreenshot(screenshot.clientId, (current) =>
        isLocalScreenshotFileForGame(current, shop, objectId)
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

const UNPUBLISHED_FIELDS: Partial<LocalScreenshot> = {
  state: "local",
  screenshotId: null,
  moderationStatus: null,
  moderationReason: null,
  uploadProgress: null,
  uploadQuality: null,
  uploadAttempts: 0,
  nextUploadAttemptAt: null,
  uploadedAt: null,
  lastError: null,
};

const forgetPublishedScreenshot = async (screenshot: LocalScreenshot) => {
  const keepsFile =
    screenshot.state === "uploaded" && (await fileExists(screenshot.path));

  if (!keepsFile) {
    await removeScreenshotPreview(screenshot.previewPath);
    await LocalScreenshotStore.delete(screenshot.clientId);
    return true;
  }

  const updated = await LocalScreenshotStore.update(
    screenshot.clientId,
    (current) =>
      current.state === "uploaded" &&
      current.screenshotId === screenshot.screenshotId
        ? { ...UNPUBLISHED_FIELDS, uploadClientId: randomUUID() }
        : {}
  );
  return updated?.state === "local";
};

export const forgetPublishedScreenshots = async (screenshotIds: string[]) => {
  const ids = new Set(screenshotIds);
  if (!ids.size) return 0;

  const screenshots = await LocalScreenshotStore.listIncludingDeleted();
  const targets = screenshots.filter(
    (screenshot) =>
      screenshot.screenshotId !== null &&
      ids.has(screenshot.screenshotId) &&
      (screenshot.state === "uploaded" || screenshot.state === "deleted")
  );

  const results = await Promise.allSettled(
    targets.map(forgetPublishedScreenshot)
  );

  let forgotten = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      if (result.value) forgotten += 1;
    } else {
      logger.error("Failed to forget a published screenshot", result.reason);
    }
  }
  return forgotten;
};
