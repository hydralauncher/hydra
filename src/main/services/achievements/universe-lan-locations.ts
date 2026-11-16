import path from "node:path";
import fs from "node:fs";

import { readDirectorySafe } from "./game-directory.js";

/**
 * UniverseLAN (https://github.com/grasmanek94/UniverseLAN) replaces the GOG
 * Galaxy SDK (Galaxy.dll / Galaxy64.dll) and stores unlocked achievements in
 * `UniverseLANData/Achievements.ini`. That data folder lives either next to a
 * `UniverseLAN.ini` inside the game folder (legacy layout) or, by default, in
 * `%LOCALAPPDATA%/UniverseLAN/<rootGameId>/UniverseLANData`, where the id comes
 * from the game's `goggame-<id>.info` files.
 */
export const UNIVERSE_LAN_DIR_NAME = "UniverseLAN";
export const UNIVERSE_LAN_DATA_DIR_NAME = "UniverseLANData";
export const UNIVERSE_LAN_ACHIEVEMENTS_FILE_NAME = "Achievements.ini";

const GOG_INFO_FILE_PATTERN = /^goggame-.+\.info$/i;
const GOG_GAME_ID_PATTERN = /^\d+$/;
const MAX_GOG_INFO_FILE_SIZE = 1024 * 1024;

const toGogGameId = (value: unknown) => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === "string" && GOG_GAME_ID_PATTERN.test(value.trim())) {
    return value.trim();
  }

  return null;
};

const readGogInfoRootGameId = async (filePath: string) => {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_GOG_INFO_FILE_SIZE) return null;

    const info = JSON.parse(await fs.promises.readFile(filePath, "utf-8"));

    return toGogGameId(info?.rootGameId) ?? toGogGameId(info?.gameId);
  } catch {
    return null;
  }
};

export const findGogRootGameIds = async (directories: string[]) => {
  const rootGameIds = new Set<string>();

  await Promise.all(
    directories.map(async (directory) => {
      const entries = await readDirectorySafe(directory);

      await Promise.all(
        (entries ?? [])
          .filter(
            (entry) => entry.isFile() && GOG_INFO_FILE_PATTERN.test(entry.name)
          )
          .map(async (entry) => {
            const rootGameId = await readGogInfoRootGameId(
              path.join(directory, entry.name)
            );

            if (rootGameId) rootGameIds.add(rootGameId);
          })
      );
    })
  );

  return [...rootGameIds].sort();
};

const getDefaultLocalAppDataPath = () =>
  process.platform === "win32" ? process.env.LOCALAPPDATA : undefined;

export const resolveUniverseLanDataDirectories = async (
  bases: string[],
  localAppDataPath = getDefaultLocalAppDataPath()
) => {
  if (!localAppDataPath) return [];

  const rootGameIds = await findGogRootGameIds(bases);

  return rootGameIds.map((rootGameId) =>
    path.join(
      localAppDataPath,
      UNIVERSE_LAN_DIR_NAME,
      rootGameId,
      UNIVERSE_LAN_DATA_DIR_NAME
    )
  );
};
