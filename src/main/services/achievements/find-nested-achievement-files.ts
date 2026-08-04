import type { AchievementFile } from "@types";
import { Cracker } from "@shared";

import { achievementsLogger } from "../logger";
import { getEmulatorSaveFolders } from "./find-achievement-files";
import { scanSaveFolder } from "./scan-nested-achievement-files";

/**
 * Which files exist changes at most once per game, so discovery does not need
 * the watcher's cadence. Only the mtime checks over the resulting list do.
 */
const SCAN_INTERVAL_IN_MS = 60_000;

type NestedAchievementFiles = Map<string, AchievementFile[]>;

interface CacheEntry {
  scannedAt: number;
  files: NestedAchievementFiles;
  scan?: Promise<NestedAchievementFiles>;
}

const cache = new Map<string, CacheEntry>();

const scanEmulatorSaveFolders = async (winePrefixPath: string) => {
  const files: NestedAchievementFiles = new Map();

  for (const folderPath of getEmulatorSaveFolders(winePrefixPath)) {
    const filePathsByObjectId = await scanSaveFolder(folderPath);

    for (const [objectId, filePaths] of filePathsByObjectId) {
      const objectIdFiles = files.get(objectId) ?? [];

      objectIdFiles.push(
        ...filePaths.map((filePath) => ({
          type: Cracker.goldberg,
          filePath,
        }))
      );

      files.set(objectId, objectIdFiles);
    }
  }

  return files;
};

/**
 * Finds emulator achievement files nested anywhere below an app id folder, not
 * just the canonical `<objectId>/achievements.json` the static path table
 * covers. Results are cached and refreshed on a slow interval: the watcher runs
 * every couple of seconds and must never pay for a directory walk.
 */
export const findNestedAchievementFiles = async (
  winePrefixPath = ""
): Promise<NestedAchievementFiles> => {
  const cached = cache.get(winePrefixPath);

  if (cached?.scan) return cached.scan;

  if (cached && Date.now() - cached.scannedAt < SCAN_INTERVAL_IN_MS) {
    return cached.files;
  }

  const entry: CacheEntry = {
    scannedAt: cached?.scannedAt ?? 0,
    files: cached?.files ?? new Map(),
  };

  entry.scan = scanEmulatorSaveFolders(winePrefixPath)
    .catch((error) => {
      achievementsLogger.error(
        "Failed to scan for nested achievement files",
        error
      );

      return entry.files;
    })
    .then((files) => {
      cache.set(winePrefixPath, { scannedAt: Date.now(), files });

      return files;
    });

  cache.set(winePrefixPath, entry);

  return entry.scan;
};

export const clearNestedAchievementFilesCache = () => cache.clear();
