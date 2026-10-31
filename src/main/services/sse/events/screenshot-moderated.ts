import { screenshotUploadWorker } from "@main/services/screenshots";
import type { ScreenshotModerated } from "../types";

export const screenshotModeratedEvent = async (
  payload: ScreenshotModerated,
  signal: AbortSignal
) => {
  if (signal.aborted) return;

  await screenshotUploadWorker.handleModerationResult({
    id: payload.screenshotId,
    moderationStatus: payload.moderationStatus,
    moderationReason: payload.moderationReason,
  });
};
