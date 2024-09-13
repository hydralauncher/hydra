import { userClientPreferencesRepository } from "@main/repository";
import { registerEvent } from "../register-event";

import type { client } from "@types";

const updateUserClientPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  clientPreferences: Partial<client>
) => {
  return userClientPreferencesRepository.upsert(
    {
      id: 1,
      ...clientPreferences,
    },
    ["id"]
  );
};

registerEvent("updateUserClientPreferences", updateUserClientPreferences);
