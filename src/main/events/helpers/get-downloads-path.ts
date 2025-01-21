import { defaultDownloadsPath } from "@main/constants";
import { levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { db } from "@main/level";

export const getDownloadsPath = async () => {
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (userPreferences && userPreferences.downloadsPath)
    return userPreferences.downloadsPath;

  return defaultDownloadsPath;
};
