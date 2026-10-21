import {
  buildProfileGameScreenshotsPath,
  buildProfileScreenshotPath,
  getScreenshotApiErrorCode,
} from "@shared";
import type { GameShop } from "@types";

import {
  deleteLocalScreenshotsForGame,
  getPublishedScreenshotIdsForGame,
  loadLocalScreenshotsForGame,
} from "./my-screenshots-store";

export type MyScreenshotsDeletion = "all" | "published" | "local";

const deletePublishedScreenshot = async (id: string) => {
  try {
    await window.electron.hydraApi.delete(buildProfileScreenshotPath(id), {
      needsAuth: true,
    });
  } catch (error) {
    if (getScreenshotApiErrorCode(error) !== "screenshots/not-found") {
      throw error;
    }
  }
};

export const deletePublishedScreenshotsForGame = async (
  shop: GameShop,
  objectId: string
) => {
  if (shop !== "custom") {
    const response = await window.electron.hydraApi.delete<{
      deleted: number;
    }>(buildProfileGameScreenshotsPath({ shop, objectId }), {
      needsAuth: true,
    });
    const ids = await getPublishedScreenshotIdsForGame(shop, objectId);
    if (ids.length > 0) await window.electron.forgetPublishedScreenshots(ids);
    return response?.deleted ?? 0;
  }

  const ids = await getPublishedScreenshotIdsForGame(shop, objectId);
  const deletedIds: string[] = [];

  try {
    for (const id of ids) {
      await deletePublishedScreenshot(id);
      deletedIds.push(id);
    }
  } finally {
    if (deletedIds.length > 0) {
      await window.electron.forgetPublishedScreenshots(deletedIds);
    }
  }

  return deletedIds.length;
};

export const deleteMyGameScreenshots = async (
  deletion: MyScreenshotsDeletion,
  shop: GameShop,
  objectId: string
) => {
  if (deletion === "local") {
    return deleteLocalScreenshotsForGame(shop, objectId);
  }
  if (deletion === "published") {
    return deletePublishedScreenshotsForGame(shop, objectId);
  }

  const localBefore = (await loadLocalScreenshotsForGame(shop, objectId))
    .length;
  const published = await deletePublishedScreenshotsForGame(shop, objectId);
  await deleteLocalScreenshotsForGame(shop, objectId);
  return published + localBefore;
};
