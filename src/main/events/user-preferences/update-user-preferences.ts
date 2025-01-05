import { userPreferencesRepository } from "@main/repository";
import { registerEvent } from "../register-event";

import type { UserPreferences } from "@types";
import i18next from "i18next";
import { patchUserProfile } from "../profile/update-profile";

const updateUserPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  preferences: Partial<UserPreferences>
) => {
  if (preferences.language) {
    i18next.changeLanguage(preferences.language);
    patchUserProfile({ language: preferences.language }).catch(() => {});
  }

  return userPreferencesRepository.upsert(
    {
      id: 1,
      ...preferences,
    },
    ["id"]
  );
};

registerEvent("updateUserPreferences", updateUserPreferences);
