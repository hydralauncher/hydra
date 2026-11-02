import { screenshotsPath as defaultScreenshotsPath } from "@main/constants";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

import { resolveAchievementScreenshotsDirectory } from "./achievement-screenshots-directory-path";

export const getAchievementScreenshotsDirectory = async () => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  return resolveAchievementScreenshotsDirectory(
    userPreferences?.achievementScreenshotsPath,
    defaultScreenshotsPath
  );
};
