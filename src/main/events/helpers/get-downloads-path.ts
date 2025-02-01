import { defaultDownloadsPath } from "@main/constants";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

export const getDownloadsPath = async () => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (userPreferences?.downloadsPath) return userPreferences.downloadsPath;

  return defaultDownloadsPath;
};
