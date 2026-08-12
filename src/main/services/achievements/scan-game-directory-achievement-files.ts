import path from "node:path";

import type { AchievementFile } from "@types";
import { Cracker } from "../../../shared/constants.js";

import {
  ACHIEVEMENTS_FILE_NAME,
  collectEmulatorDirectories,
  isFile,
  readDirectorySafe,
} from "./game-directory.js";
import { findSteamSettingsDirectories } from "./metadata-export/find-steam-settings-directories.js";

const OBJECT_ID_DIR_PATTERN = /^\d+$/;

const ANY_PROFILE_DIR = "*";

const RELATIVE_FILE_LOCATIONS: { type: Cracker; segments: string[] }[] = [
  { type: Cracker.userstats, segments: ["SteamData", "user_stats.ini"] },
  {
    type: Cracker._3dm,
    segments: ["3DMGAME", ANY_PROFILE_DIR, "stats", "achievements.ini"],
  },
  {
    type: Cracker.ali213,
    segments: ["Profile", ANY_PROFILE_DIR, "Stats", "Achievements.Bin"],
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

export const resolveGameDirectoryLocations = async (
  executablePath: string
): Promise<GameDirectoryLocations> => {
  if (!executablePath) return EMPTY_GAME_DIRECTORY_LOCATIONS;

  const [bases, steamSettingsDirectories] = await Promise.all([
    collectEmulatorDirectories(executablePath),
    findSteamSettingsDirectories(executablePath),
  ]);

  return { bases, steamSettingsDirectories };
};

const resolveCandidatePaths = async (base: string, segments: string[]) => {
  const profileIndex = segments.indexOf(ANY_PROFILE_DIR);

  if (profileIndex === -1) return [path.join(base, ...segments)];

  const profilesDirectory = path.join(base, ...segments.slice(0, profileIndex));
  const remainingSegments = segments.slice(profileIndex + 1);

  const entries = await readDirectorySafe(profilesDirectory);

  return (entries ?? [])
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      path.join(profilesDirectory, entry.name, ...remainingSegments)
    );
};

const findRelativeFiles = async (bases: string[]) => {
  const achievementFiles: AchievementFile[] = [];

  await Promise.all(
    bases.flatMap((base) =>
      RELATIVE_FILE_LOCATIONS.map(async ({ type, segments }) => {
        const candidatePaths = await resolveCandidatePaths(base, segments);

        await Promise.all(
          candidatePaths.map(async (filePath) => {
            if (await isFile(filePath)) {
              achievementFiles.push({ type, filePath });
            }
          })
        );
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
