import type { TFunction } from "i18next";

import type { ProfileScreenshot } from "@types";

export const getScreenshotGameTitle = (
  screenshot: Pick<ProfileScreenshot, "gameTitle" | "isCustomGame">,
  t: TFunction
) => {
  if (screenshot.gameTitle) return screenshot.gameTitle;
  return screenshot.isCustomGame ? t("custom_game") : t("unknown_game");
};

export const isScreenshotApproved = (
  screenshot: Pick<ProfileScreenshot, "moderationStatus">
) => !screenshot.moderationStatus || screenshot.moderationStatus === "APPROVED";
