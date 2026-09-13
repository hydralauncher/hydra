import type { AchievementFile } from "@types";

import { achievementsLogger } from "../logger";
import {
  EMPTY_GAME_DIRECTORY_LOCATIONS,
  findAchievementFilesInLocations,
  resolveGameDirectoryLocations,
  type GameDirectoryLocations,
} from "./scan-game-directory-achievement-files";
import { createThrottledCache } from "./throttled-cache";

const LOCATIONS_INTERVAL_IN_MS = 5 * 60_000;

const locationsCache = createThrottledCache<GameDirectoryLocations>(
  resolveGameDirectoryLocations,
  LOCATIONS_INTERVAL_IN_MS,
  () => EMPTY_GAME_DIRECTORY_LOCATIONS,
  (error) =>
    achievementsLogger.error(
      "Failed to resolve the game directory locations",
      error
    )
);

export const findGameDirectoryAchievementFiles = (
  executablePath?: string | null,
  { awaitLocations = false } = {}
): Promise<AchievementFile[]> => {
  if (!executablePath) return Promise.resolve([]);

  if (!awaitLocations) {
    return findAchievementFilesInLocations(locationsCache.get(executablePath));
  }

  return locationsCache
    .resolve(executablePath)
    .then(findAchievementFilesInLocations);
};
