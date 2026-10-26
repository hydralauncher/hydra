import type { ScreenshotQuality } from "@types";

export const resolveScreenshotUploadQuality = (
  requested: ScreenshotQuality | null | undefined,
  hasCloudSubscription: boolean
): ScreenshotQuality =>
  hasCloudSubscription ? (requested ?? "CLOUD") : "STANDARD";

export const toLocalScreenshotUrl = (path: string) =>
  `local:${path.replaceAll("\\", "/")}`;
