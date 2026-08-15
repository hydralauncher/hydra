import { createHash } from "node:crypto";
import path from "node:path";

const SCREENSHOT_EXTENSION = "jpeg";

const sanitizePathSegment = (value: string) =>
  Array.from(value)
    .filter((character) => (character.codePointAt(0) ?? 0) > 31)
    .join("")
    .replaceAll(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 120)
    .trim() || "unknown";

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
