import path from "node:path";
import { app } from "electron";

import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

import { resolveAchievementScreenshotsDirectory } from "../achievement-screenshots-directory-path";
import { SystemPath } from "../system-path";

const SCREENSHOTS_FOLDER_NAME = "Hydra";

const getPicturesDirectory = () => {
  try {
    return app.getPath("pictures");
  } catch {
    return path.join(SystemPath.getPath("home"), "Pictures");
  }
};

export const getDefaultScreenshotsFolder = () =>
  path.join(getPicturesDirectory(), SCREENSHOTS_FOLDER_NAME);

export const getScreenshotsFolder = async () => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  return resolveAchievementScreenshotsDirectory(
    userPreferences?.screenshotsFolderPath,
    getDefaultScreenshotsFolder()
  );
};
