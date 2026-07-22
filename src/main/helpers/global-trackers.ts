import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

export const getGlobalTrackers = async (): Promise<string[]> => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  return [
    ...(userPreferences?.appendGlobalTrackers
      ? (userPreferences?.globalTrackers ?? [])
      : []),
    ...(userPreferences?.appendGlobalTrackersUrl
      ? (userPreferences?.globalTrackersUrlCache ?? [])
      : []),
  ];
};
