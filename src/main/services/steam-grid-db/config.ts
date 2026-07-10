import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

export const getUserPreferencesRecord =
  async (): Promise<UserPreferences | null> => {
    try {
      const preferences = await db.get<string, UserPreferences>(
        levelKeys.userPreferences,
        { valueEncoding: "json" }
      );
      return preferences ?? null;
    } catch {
      return null;
    }
  };
