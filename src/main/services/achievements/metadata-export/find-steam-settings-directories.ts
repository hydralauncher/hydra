import path from "node:path";

import { isUnsafePath } from "../../../events/helpers/find-game-root.js";
import {
  STEAM_SETTINGS_DIR_NAME,
  collectEmulatorDirectories,
  isDirectory,
  readDirectorySafe,
  resolveGameSearchRoot,
} from "../game-directory.js";

const MAX_DEPTH = 8;
const MAX_DIRECTORIES_VISITED = 2000;

const COLD_CLIENT_DIR_NAME = "coldclient";

const STEAM_SETTINGS_RELATIVE_PATHS = [
  [STEAM_SETTINGS_DIR_NAME],
  [COLD_CLIENT_DIR_NAME, STEAM_SETTINGS_DIR_NAME],
];

const IGNORED_DIRS = new Set([
  ".git",
  "audio",
  "config",
  "configs",
  "content",
  "data",
  "intermediate",
  "localization",
  "logs",
  "movies",
  "music",
  "pak",
  "paks",
  "saved",
  "saves",
  "shaders",
  "sound",
  "sounds",
  "textures",
  "videos",
]);

const searchBreadthFirst = async (searchRoot: string) => {
  const found: string[] = [];

  let currentLevel = [searchRoot];
  let visited = 0;

  for (let depth = 0; depth < MAX_DEPTH && currentLevel.length; depth++) {
    const nextLevel: string[] = [];

    for (const dirPath of currentLevel) {
      if (visited >= MAX_DIRECTORIES_VISITED) break;

      visited++;

      const entries = await readDirectorySafe(dirPath);

      if (!entries) continue;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const name = entry.name.toLowerCase();

        if (name === STEAM_SETTINGS_DIR_NAME) {
          found.push(path.join(dirPath, entry.name));
          continue;
        }

        if (IGNORED_DIRS.has(name)) continue;

        nextLevel.push(path.join(dirPath, entry.name));
      }
    }

    if (found.length) break;

    currentLevel = nextLevel;
  }

  return found;
};

export const findSteamSettingsDirectories = async (executablePath: string) => {
  if (isUnsafePath(path.dirname(executablePath))) return [];

  const emulatorDirectories = await collectEmulatorDirectories(executablePath);

  const directories = new Set<string>();

  await Promise.all(
    emulatorDirectories.flatMap((emulatorDirectory) =>
      STEAM_SETTINGS_RELATIVE_PATHS.map(async (segments) => {
        const candidate = path.join(emulatorDirectory, ...segments);

        if (await isDirectory(candidate)) {
          directories.add(path.resolve(candidate));
        }
      })
    )
  );

  if (directories.size) return [...directories];

  const searchRoot = await resolveGameSearchRoot(executablePath);

  for (const directory of await searchBreadthFirst(searchRoot)) {
    directories.add(path.resolve(directory));
  }

  return [...directories];
};
