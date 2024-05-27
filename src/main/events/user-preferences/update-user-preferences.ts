import { userPreferencesRepository } from "@main/repository";
import { registerEvent } from "../register-event";

import type { UserPreferences } from "@types";
import { RealDebridClient } from "@main/services/real-debrid";

const updateUserPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  preferences: Partial<UserPreferences>
) => {
  if (preferences.realDebridApiToken) {
    RealDebridClient.authorize(preferences.realDebridApiToken);
  }

  await userPreferencesRepository.upsert(
    {
      id: 1,
      ...preferences,
    },
    ["id"]
  );
};

registerEvent("updateUserPreferences", updateUserPreferences);
