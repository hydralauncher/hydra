import {
  normalizeScreenshotDescription,
  resolveScreenshotUploadQuality,
} from "@shared";
import type {
  LocalScreenshot,
  LocalScreenshotUploadOptions,
  ProfileVisibility,
  LocalScreenshotState,
  ScreenshotQuality,
} from "@types";

export interface ScreenshotReviewDraft {
  isSpoiler: boolean;
  visibility: ProfileVisibility;
  customGameTitle: string;
  description: string;
  quality?: ScreenshotQuality;
}

export const SCREENSHOT_QUALITY_LABELS: Record<ScreenshotQuality, string> = {
  STANDARD: "720p",
  CLOUD: "1080p",
};

export const createReviewDraft = (
  screenshot: LocalScreenshot
): ScreenshotReviewDraft => ({
  isSpoiler: screenshot.isSpoiler,
  visibility: screenshot.visibility,
  customGameTitle: screenshot.customGameTitle ?? "",
  description: screenshot.description ?? "",
});

export const toUploadOptions = (
  screenshot: LocalScreenshot,
  draft: ScreenshotReviewDraft,
  hasCloudSubscription: boolean
): LocalScreenshotUploadOptions => {
  const title = draft.customGameTitle.trim();
  return {
    isSpoiler: draft.isSpoiler,
    visibility: draft.visibility,
    customGameTitle: screenshot.shop === "custom" && title ? title : null,
    description: normalizeScreenshotDescription(draft.description),
    quality: resolveScreenshotUploadQuality(
      draft.quality,
      hasCloudSubscription
    ),
  };
};

const EDITABLE_STATES = new Set<LocalScreenshotState>(["local", "failed"]);

export const isScreenshotEditable = (screenshot: LocalScreenshot) =>
  EDITABLE_STATES.has(screenshot.state);

export const isScreenshotUndecided = (screenshot: LocalScreenshot) =>
  screenshot.state === "local";
