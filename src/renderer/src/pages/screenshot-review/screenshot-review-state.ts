import type {
  LocalScreenshot,
  ProfileVisibility,
  LocalScreenshotState,
  ScreenshotUploadProgress,
} from "@types";

export interface ScreenshotReviewDraft {
  isSpoiler: boolean;
  visibility: ProfileVisibility;
  customGameTitle: string;
}

export const createReviewDraft = (
  screenshot: LocalScreenshot
): ScreenshotReviewDraft => ({
  isSpoiler: screenshot.isSpoiler,
  visibility: screenshot.visibility,
  customGameTitle: screenshot.customGameTitle ?? "",
});

export const toUploadOptions = (
  screenshot: LocalScreenshot,
  draft: ScreenshotReviewDraft
) => {
  const title = draft.customGameTitle.trim();
  return {
    isSpoiler: draft.isSpoiler,
    visibility: draft.visibility,
    customGameTitle: screenshot.shop === "custom" && title ? title : null,
  };
};

export type ScreenshotReviewTone = "pending" | "progress" | "success" | "error";

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
  return "pending";
};

const EDITABLE_STATES = new Set<LocalScreenshotState>([
  "local",
  "reviewing",
  "failed",
]);

export const getLocalImageSource = (path: string) =>
  `local:${path.replaceAll("\\", "/")}`;

export const parseClientIds = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((clientId) => clientId.trim())
    .filter(Boolean);

export const isScreenshotEditable = (screenshot: LocalScreenshot) =>
  EDITABLE_STATES.has(screenshot.state);

export const isScreenshotAwaitingReview = (screenshot: LocalScreenshot) =>
  screenshot.state === "local" || screenshot.state === "reviewing";

export const getUploadPercent = (screenshot: LocalScreenshot) =>
  Math.round(Math.min(Math.max(screenshot.uploadProgress ?? 0, 0), 1) * 100);

export const getQueuedMessageKey = (lastError: string | null) => {
  if (lastError === "game/not-found") return "error_waiting_for_game";
  if (lastError?.startsWith("feature/")) return "error_feature_disabled";
  if (lastError === "screenshots/upload-rate-limited") {
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
