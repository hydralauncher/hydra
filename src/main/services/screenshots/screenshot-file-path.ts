import path from "node:path";

import { sanitizePathSegment } from "../achievement-screenshot-path";

const MANUAL_SCREENSHOT_EXTENSION = "jpeg";

const padNumber = (value: number, length = 2) =>
  String(value).padStart(length, "0");

export const formatScreenshotTimestamp = (date: Date) =>
  [
    `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`,
    `${padNumber(date.getHours())}-${padNumber(date.getMinutes())}-${padNumber(date.getSeconds())}-${padNumber(date.getMilliseconds(), 3)}`,
  ].join("_");

export const resolveManualScreenshotPath = (
  screenshotsRoot: string,
  gameTitle: string,
  capturedAt: Date,
  suffix = 0
) => {
  const suffixPart = suffix ? `-${suffix}` : "";

  return path.join(
    screenshotsRoot,
    sanitizePathSegment(gameTitle.replaceAll(/[#%]/g, "_")),
    `${formatScreenshotTimestamp(capturedAt)}${suffixPart}.${MANUAL_SCREENSHOT_EXTENSION}`
  );
};
