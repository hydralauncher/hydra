import path from "node:path";

export const resolveAchievementScreenshotsDirectory = (
  preferredPath: string | null | undefined,
  defaultPath: string
) => {
  const trimmedPath = preferredPath?.trim();

  if (!trimmedPath || !path.isAbsolute(trimmedPath)) return defaultPath;

  return path.normalize(trimmedPath);
};
