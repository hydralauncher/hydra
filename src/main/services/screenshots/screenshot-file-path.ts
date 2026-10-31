import path from "node:path";

import { sanitizePathSegment } from "../achievement-screenshot-path.js";

const MANUAL_SCREENSHOT_EXTENSION = "jpeg";
const WINDOWS_RESERVED_DEVICE_NAME =
  /^(con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?= *(\.|$))/i;

const toScreenshotFolderName = (gameTitle: string) =>
  sanitizePathSegment(gameTitle.replaceAll(/[#%]/g, "_")).replace(
    WINDOWS_RESERVED_DEVICE_NAME,
    "$1_"
  );

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
  suffix: number | string = 0
) => {
  const suffixPart = suffix ? `-${suffix}` : "";

  return path.join(
    screenshotsRoot,
    toScreenshotFolderName(gameTitle),
    `${formatScreenshotTimestamp(capturedAt)}${suffixPart}.${MANUAL_SCREENSHOT_EXTENSION}`
  );
};
