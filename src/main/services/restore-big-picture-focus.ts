import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

import { WindowManager } from "./window-manager";

export const restoreBigPictureFocusOnGameCloseIfEnabled = () => {
  void db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .then((userPreferences) => {
      if (userPreferences?.restoreBigPictureFocusOnGameClose === false) return;

      WindowManager.focusBigPictureIfOpen();
    })
    .catch(() => {});
};
