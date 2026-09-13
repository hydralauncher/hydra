import { createHash } from "node:crypto";
import path from "node:path";

const SCREENSHOT_EXTENSION = "jpeg";

const stripTrailingDotsAndSpaces = (value: string) => {
  let endIndex = value.length;

  while (
    endIndex > 0 &&
    (value[endIndex - 1] === "." || value[endIndex - 1] === " ")
  ) {
    endIndex--;
  }

  return value.slice(0, endIndex);
};

const sanitizePathSegment = (value: string) => {
  const sanitizedValue = Array.from(value)
    .filter((character) => (character.codePointAt(0) ?? 0) > 31)
    .join("")
    .replaceAll(/[<>:"/\\|?*]/g, "_");

  return (
    stripTrailingDotsAndSpaces(sanitizedValue).slice(0, 120).trim() || "unknown"
  );
};

const getStableSuffix = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 12);

export const resolveAchievementScreenshotPath = (
  rootPath: string,
  gameTitle: string,
  achievementDisplayName: string,
  gameId: string,
  achievementId: string
) =>
  path.join(
    rootPath,
    `${sanitizePathSegment(gameTitle)}-${getStableSuffix(gameId)}`,
    `${sanitizePathSegment(achievementDisplayName)}-${getStableSuffix(achievementId)}.${SCREENSHOT_EXTENSION}`
  );
