import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

import { logger } from "./logger";
import { WindowManager } from "./window-manager";

export const restoreBigPictureFocusOnGameCloseIfEnabled = () => {
  setTimeout(() => {
    void (async () => {
      try {
        const userPreferences = await db.get<string, UserPreferences | null>(
          levelKeys.userPreferences,
          { valueEncoding: "json" }
        );

        if (userPreferences?.restoreBigPictureFocusOnGameClose === false)
          return;
      } catch (error) {
        logger.error(
          "restoreBigPictureFocusOnGameCloseIfEnabled failed to read prefs",
          error
        );
      }

      WindowManager.focusBigPictureIfOpen();
    })();
  }, 250);
};
