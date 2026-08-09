import path from "node:path";

import type { AchievementFile } from "@types";
import { Cracker } from "../../../shared/constants.js";

import {
  NESTED_EXECUTABLE_DIRS,
  isFile,
  readDirectorySafe,
  resolveGameSearchRoot,
} from "./game-directory.js";
import { findSteamSettingsDirectories } from "./metadata-export/find-steam-settings-directories.js";

const ACHIEVEMENTS_FILE_NAME = "achievements.json";

const OBJECT_ID_DIR_PATTERN = /^\d+$/;

const RELATIVE_FILE_LOCATIONS: { type: Cracker; segments: string[] }[] = [
  { type: Cracker.userstats, segments: ["SteamData", "user_stats.ini"] },
  {
    type: Cracker._3dm,
    segments: ["3DMGAME", "Player", "stats", "achievements.ini"],
  },
  {
    type: Cracker.ali213,
    segments: ["Profile", "Player", "Stats", "Achievements.Bin"],
  },
];

export interface GameDirectoryLocations {
  bases: string[];
  steamSettingsDirectories: string[];
}

export const EMPTY_GAME_DIRECTORY_LOCATIONS: GameDirectoryLocations = {
  bases: [],
  steamSettingsDirectories: [],
};

const collectSearchBases = async (executablePath: string) => {
  const executableDirectory = path.dirname(executablePath);
  const searchRoot = await resolveGameSearchRoot(executablePath);

  const bases = new Set([executableDirectory, searchRoot]);

  const entries = await readDirectorySafe(searchRoot);

  for (const entry of entries ?? []) {
    if (!entry.isDirectory()) continue;

    if (NESTED_EXECUTABLE_DIRS.has(entry.name.toLowerCase())) {
      bases.add(path.join(searchRoot, entry.name));
    }
  }

  return [...bases];
};

export const resolveGameDirectoryLocations = async (
  executablePath: string
): Promise<GameDirectoryLocations> => {
  if (!executablePath) return EMPTY_GAME_DIRECTORY_LOCATIONS;

  const [bases, steamSettingsDirectories] = await Promise.all([
    collectSearchBases(executablePath),
    findSteamSettingsDirectories(executablePath),
  ]);

  return { bases, steamSettingsDirectories };
};

const findRelativeFiles = async (bases: string[]) => {
  const achievementFiles: AchievementFile[] = [];

  await Promise.all(
    bases.flatMap((base) =>
      RELATIVE_FILE_LOCATIONS.map(async ({ type, segments }) => {
        const filePath = path.join(base, ...segments);

        if (await isFile(filePath)) {
          achievementFiles.push({ type, filePath });
        }
      })
    )
  );

  return achievementFiles;
};

const findSteamSettingsFiles = async (steamSettingsDirectories: string[]) => {
  const achievementFiles: AchievementFile[] = [];

  await Promise.all(
    steamSettingsDirectories.map(async (steamSettingsDirectory) => {
      const entries = await readDirectorySafe(steamSettingsDirectory);

      for (const entry of entries ?? []) {
        if (!entry.isDirectory()) continue;
        if (!OBJECT_ID_DIR_PATTERN.test(entry.name)) continue;

        const filePath = path.join(
          steamSettingsDirectory,
          entry.name,
          ACHIEVEMENTS_FILE_NAME
        );

        if (await isFile(filePath)) {
          achievementFiles.push({ type: Cracker.goldberg, filePath });
        }
      }
    })
  );

  return achievementFiles;
};

export const findAchievementFilesInLocations = async ({
  bases,
  steamSettingsDirectories,
}: GameDirectoryLocations): Promise<AchievementFile[]> => {
  if (!bases.length && !steamSettingsDirectories.length) return [];

  const [relativeFiles, steamSettingsFiles] = await Promise.all([
    findRelativeFiles(bases),
    findSteamSettingsFiles(steamSettingsDirectories),
  ]);

  return [...relativeFiles, ...steamSettingsFiles];
};

export const scanGameDirectoryAchievementFiles = async (
  executablePath: string
): Promise<AchievementFile[]> =>
  findAchievementFilesInLocations(
    await resolveGameDirectoryLocations(executablePath)
  );
