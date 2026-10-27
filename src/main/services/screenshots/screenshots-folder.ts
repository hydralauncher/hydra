import path from "node:path";
import { app } from "electron";

import { resolveAchievementScreenshotsDirectory } from "../achievement-screenshots-directory-path";
import { SystemPath } from "../system-path";
import { readUserPreferences } from "./screenshot-user-preferences";

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
  const userPreferences = await readUserPreferences();

  return resolveAchievementScreenshotsDirectory(
    userPreferences?.screenshotsFolderPath,
    getDefaultScreenshotsFolder()
  );
};
