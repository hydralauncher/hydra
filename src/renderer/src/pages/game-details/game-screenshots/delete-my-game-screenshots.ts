import {
  buildProfileGameScreenshotsPath,
  buildProfileScreenshotPath,
  getScreenshotApiErrorCode,
} from "@shared";
import type { GameShop } from "@types";

import {
  deleteLocalScreenshotsForGame,
  getPublishedScreenshotIdsForGame,
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
    return response?.deleted ?? 0;
  }

  const ids = await getPublishedScreenshotIdsForGame(shop, objectId);
  let deleted = 0;
  for (const id of ids) {
    await deletePublishedScreenshot(id);
    deleted += 1;
  }
  return deleted;
};

export const deleteMyGameScreenshots = async (
  deletion: MyScreenshotsDeletion,
  shop: GameShop,
  objectId: string
) => {
  let deleted = 0;
  if (deletion !== "local") {
    deleted += await deletePublishedScreenshotsForGame(shop, objectId);
  }
  if (deletion !== "published") {
    deleted += await deleteLocalScreenshotsForGame(shop, objectId);
  }
  return deleted;
};
