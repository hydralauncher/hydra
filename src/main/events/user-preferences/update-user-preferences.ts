import { registerEvent } from "../register-event";

import type { UserPreferences } from "@types";
import i18next from "i18next";
import { db, levelKeys } from "@main/level";
import { patchUserProfile } from "../profile/update-profile";

const updateUserPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  preferences: Partial<UserPreferences>
) => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  if (preferences.language) {
    await db.put<string, string>(levelKeys.language, preferences.language, {
      valueEncoding: "utf-8",
    });

    i18next.changeLanguage(preferences.language);
    patchUserProfile({ language: preferences.language }).catch(() => {});
  }

  if (!preferences.downloadsPath) {
    preferences.downloadsPath = null;
  }

  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      ...userPreferences,
      ...preferences,
    },
    {
      valueEncoding: "json",
    }
  );
};

registerEvent("updateUserPreferences", updateUserPreferences);
