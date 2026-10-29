import type {
  ProfileScreenshot,
  ProfileVisibility,
  ScreenshotUpdateRequest,
} from "@types";

import { normalizeScreenshotDescription } from "./screenshot-preferences";

export interface ScreenshotSettingsValues {
  visibility: ProfileVisibility;
  isSpoiler: boolean;
  commentsEnabled: boolean;
  customGameTitle: string;
  description: string;
}

export const readScreenshotSettings = (
  screenshot: ProfileScreenshot
): ScreenshotSettingsValues => ({
  visibility: screenshot.visibility ?? "PUBLIC",
  isSpoiler: screenshot.isSpoiler,
  commentsEnabled: screenshot.commentsEnabled,
  customGameTitle: screenshot.isCustomGame ? (screenshot.gameTitle ?? "") : "",
  description: screenshot.description ?? "",
});

export const buildScreenshotSettingsUpdate = (
  screenshot: ProfileScreenshot,
  values: ScreenshotSettingsValues
): ScreenshotUpdateRequest => {
  const current = readScreenshotSettings(screenshot);
  const update: ScreenshotUpdateRequest = {};

  if (values.visibility !== current.visibility) {
    update.visibility = values.visibility;
  }
  if (values.isSpoiler !== current.isSpoiler) {
    update.isSpoiler = values.isSpoiler;
  }
  if (values.commentsEnabled !== current.commentsEnabled) {
    update.commentsEnabled = values.commentsEnabled;
  }

  const customGameTitle = values.customGameTitle.trim();
  if (screenshot.isCustomGame && customGameTitle !== current.customGameTitle) {
    update.customGameTitle = customGameTitle || null;
  }

  const description = normalizeScreenshotDescription(values.description);
  if (description !== normalizeScreenshotDescription(current.description)) {
    update.description = description;
  }

  return update;
};
