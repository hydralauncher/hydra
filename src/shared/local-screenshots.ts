import type { ScreenshotQuality } from "@types";

export const resolveScreenshotUploadQuality = (
  requested: ScreenshotQuality | null | undefined,
  hasCloudSubscription: boolean
): ScreenshotQuality =>
  hasCloudSubscription ? (requested ?? "CLOUD") : "STANDARD";

const encodeLocalPath = (path: string) =>
  path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");

export const toLocalScreenshotUrl = (path: string) =>
  `local:${encodeLocalPath(path)}`;
