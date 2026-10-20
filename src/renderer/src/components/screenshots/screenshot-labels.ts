import type { TFunction } from "i18next";

import type { ProfileScreenshot } from "@types";

const KNOWN_MODERATION_REASONS = new Set([
  "explicit_imagery",
  "real_world_gore",
  "hate_symbols",
  "personal_information",
  "invalid_image",
]);

export const getScreenshotGameTitle = (
  screenshot: Pick<ProfileScreenshot, "gameTitle" | "isCustomGame">,
  t: TFunction
) => {
  if (screenshot.gameTitle) return screenshot.gameTitle;
  return screenshot.isCustomGame ? t("custom_game") : t("unknown_game");
};

export const getScreenshotModerationReason = (
  reason: string | null | undefined,
  t: TFunction
) =>
  reason && KNOWN_MODERATION_REASONS.has(reason)
    ? t(`moderation_reason_${reason}`)
    : t("moderation_reason_generic");
