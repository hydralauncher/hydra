import { userPreferencesRepository } from "@main/repository";
import { registerEvent } from "./register-event";
import { dialog } from "electron";
import { t } from "i18next";
import type { UserPreferences } from "@types";
import validatePath from "./helpers/validate-path";

const updateUserPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  preferences: Partial<UserPreferences>
) => {
  const payload = async () =>
    await userPreferencesRepository.upsert(
      {
        id: 1,
        ...preferences,
      },
      ["id"]
    );

  if (preferences.downloadsPath) {
    const error = validatePath(preferences.downloadsPath);

    if (!error) {
      payload();
      return true;
    }
    dialog.showErrorBox(
      t("error_title_modal", {
        ns: "settings",
        lng: "en",
      }),
      `${t("error_description_modal", {
        ns: "settings",
        lng: "en",
      })}${error instanceof Error ? "\n" + error.message : ""}`
    );
    return false;
  }
  payload();
  return true;
};

registerEvent(updateUserPreferences, {
  name: "updateUserPreferences",
});
