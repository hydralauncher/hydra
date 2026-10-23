import type { LocalScreenshot } from "@types";

export const toLocalScreenshotUrl = (path: string) =>
  `local:${path.replaceAll("\\", "/")}`;

const SETTLED_LOCAL_SCREENSHOT_STATES = new Set(["uploaded", "deleted"]);

export const isLocalScreenshotPending = (screenshot: LocalScreenshot) =>
  !SETTLED_LOCAL_SCREENSHOT_STATES.has(screenshot.state);

export const isLocalScreenshotForGame = (
  screenshot: LocalScreenshot,
  shop: string,
  objectId: string
) => screenshot.shop === shop && screenshot.objectId === objectId;
