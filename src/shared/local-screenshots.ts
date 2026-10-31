import type { LocalScreenshot, ScreenshotQuality } from "@types";

export const resolveScreenshotUploadQuality = (
  hasCloudSubscription: boolean
): ScreenshotQuality => (hasCloudSubscription ? "CLOUD" : "STANDARD");

const encodeLocalPath = (path: string) => encodeURI(path);

export const toLocalScreenshotUrl = (path: string) =>
  `local:${encodeLocalPath(path)}`;

const SETTLED_LOCAL_SCREENSHOT_STATES = new Set(["uploaded", "deleted"]);

export const isLocalScreenshotPending = (screenshot: LocalScreenshot) =>
  !SETTLED_LOCAL_SCREENSHOT_STATES.has(screenshot.state);

export const isLocalScreenshotForGame = (
  screenshot: LocalScreenshot,
  shop: string,
  objectId: string
) => screenshot.shop === shop && screenshot.objectId === objectId;
