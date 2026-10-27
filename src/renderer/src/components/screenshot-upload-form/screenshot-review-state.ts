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
  ScreenshotUploadProgress,
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

export type ScreenshotReviewTone =
  | "pending"
  | "kept"
  | "progress"
  | "success"
  | "error";

export const getReviewTone = (
  screenshot: LocalScreenshot
): ScreenshotReviewTone => {
  if (screenshot.state === "failed") return "error";
  if (screenshot.state === "queued" || screenshot.state === "uploading") {
    return "progress";
  }
  if (screenshot.state === "uploaded") {
    return screenshot.moderationStatus === "BLOCKED" ? "error" : "success";
  }
  if (screenshot.state === "local") return "kept";
  return "pending";
};

const EDITABLE_STATES = new Set<LocalScreenshotState>([
  "local",
  "reviewing",
  "failed",
]);

export { toLocalScreenshotUrl as getLocalImageSource } from "@shared";

export const isScreenshotEditable = (screenshot: LocalScreenshot) =>
  EDITABLE_STATES.has(screenshot.state);

export const isScreenshotAwaitingReview = (screenshot: LocalScreenshot) =>
  screenshot.state === "reviewing";

export const isScreenshotKeptLocally = (screenshot: LocalScreenshot) =>
  screenshot.state === "local";

export const isScreenshotUndecided = (screenshot: LocalScreenshot) =>
  isScreenshotAwaitingReview(screenshot) || isScreenshotKeptLocally(screenshot);

export const getUploadPercent = (screenshot: LocalScreenshot) =>
  Math.round(Math.min(Math.max(screenshot.uploadProgress ?? 0, 0), 1) * 100);

export const getQueuedMessageKey = (lastError: string | null) => {
  if (lastError === "game/not-found") return "error_waiting_for_game";
  if (
    lastError === "screenshots/upload-rate-limited" ||
    lastError === "screenshots/upload-capacity-reached"
  ) {
    return "error_rate_limited";
  }
  return null;
};

export const applyUploadProgress = (
  screenshots: LocalScreenshot[],
  { clientId, state, progress }: ScreenshotUploadProgress
) =>
  screenshots.map((screenshot) =>
    screenshot.clientId === clientId
      ? { ...screenshot, state, uploadProgress: progress }
      : screenshot
  );

export const selectReviewScreenshots = (
  screenshots: LocalScreenshot[],
  clientIds: string[]
) => {
  const screenshotsById = new Map(
    screenshots.map((screenshot) => [screenshot.clientId, screenshot])
  );

  return clientIds
    .map((clientId) => screenshotsById.get(clientId))
    .filter(
      (screenshot): screenshot is LocalScreenshot =>
        screenshot !== undefined && screenshot.state !== "deleted"
    );
};
