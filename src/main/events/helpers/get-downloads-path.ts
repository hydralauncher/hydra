import { defaultDownloadsPath } from "@main/constants";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

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
