import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

import { logger } from "./logger";
import { WindowManager } from "./window-manager";

const isWayland =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" ||
    Boolean(process.env.WAYLAND_DISPLAY));

export const restoreBigPictureFocusOnGameCloseIfEnabled = () => {
  if (isWayland) {
    logger.info(
      "Wayland detected — Big Picture focus restoration is not supported"
    );
    return;
  }

  setTimeout(() => {
    void (async () => {
      try {
        const userPreferences = await db.get<string, UserPreferences | null>(
          levelKeys.userPreferences,
          { valueEncoding: "json" }
        );

        if (userPreferences?.restoreBigPictureFocusOnGameClose === false)
          return;

        WindowManager.focusBigPictureIfOpen();
      } catch (error) {
        logger.error(
          "restoreBigPictureFocusOnGameCloseIfEnabled failed",
          error
        );
      }
    })();
  }, 250);
};
