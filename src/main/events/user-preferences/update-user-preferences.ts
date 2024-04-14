import { userPreferencesRepository } from "@main/repository";
import { registerEvent } from "../register-event";

import type { UserPreferences } from "@types";

const updateUserPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  preferences: Partial<UserPreferences>
) => {
  await userPreferencesRepository.upsert(
    {
      id: 1,
      ...preferences,
    },
    ["id"]
  );
};

registerEvent(updateUserPreferences, {
  name: "updateUserPreferences",
});
