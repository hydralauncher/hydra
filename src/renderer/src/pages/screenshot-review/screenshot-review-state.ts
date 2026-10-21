import type {
  LocalScreenshot,
  LocalScreenshotState,
  ScreenshotUploadProgress,
} from "@types";

export type ScreenshotReviewVariant = "single" | "grid";

const EDITABLE_STATES: LocalScreenshotState[] = [
  "local",
  "reviewing",
  "failed",
];

export const getLocalImageSource = (path: string) =>
  `local:${path.replaceAll("\\", "/")}`;

export const parseClientIds = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((clientId) => clientId.trim())
    .filter(Boolean);

export const isScreenshotEditable = (screenshot: LocalScreenshot) =>
  EDITABLE_STATES.includes(screenshot.state);

export const isScreenshotAwaitingReview = (screenshot: LocalScreenshot) =>
  screenshot.state === "local" || screenshot.state === "reviewing";

export const isScreenshotReviewDone = (screenshot: LocalScreenshot) =>
  screenshot.state === "uploaded" || screenshot.state === "failed";

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
  clientIds: string[],
  hiddenClientIds: string[]
) => {
  const screenshotsById = new Map(
    screenshots.map((screenshot) => [screenshot.clientId, screenshot])
  );

  return clientIds
    .filter((clientId) => !hiddenClientIds.includes(clientId))
    .map((clientId) => screenshotsById.get(clientId))
    .filter(
      (screenshot): screenshot is LocalScreenshot =>
        screenshot !== undefined && screenshot.state !== "deleted"
    );
};
