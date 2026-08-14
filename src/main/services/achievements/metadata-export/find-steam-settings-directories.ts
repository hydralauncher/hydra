import path from "node:path";

import { isUnsafePath } from "../../../events/helpers/find-game-root.js";
import {
  STEAM_SETTINGS_DIR_NAME,
  collectEmulatorDirectories,
  readDirectorySafe,
  resolveContainedDirectory,
  resolveContainmentRoot,
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

const splitDirectoryEntries = async (dirPath: string) => {
  const found: string[] = [];
  const nextLevel: string[] = [];

  const entries = await readDirectorySafe(dirPath);

  for (const entry of entries ?? []) {
    if (!entry.isDirectory()) continue;

    const name = entry.name.toLowerCase();

    if (name === STEAM_SETTINGS_DIR_NAME) {
      found.push(path.join(dirPath, entry.name));
    } else if (!IGNORED_DIRS.has(name)) {
      nextLevel.push(path.join(dirPath, entry.name));
    }
  }

  return { found, nextLevel };
};

const searchBreadthFirst = async (searchRoot: string) => {
  const found: string[] = [];

  let currentLevel = [searchRoot];
  let visited = 0;

  for (let depth = 0; depth < MAX_DEPTH && currentLevel.length; depth++) {
    const nextLevel: string[] = [];

    for (const dirPath of currentLevel) {
      if (visited >= MAX_DIRECTORIES_VISITED) break;

      visited++;

      const level = await splitDirectoryEntries(dirPath);

      found.push(...level.found);
      nextLevel.push(...level.nextLevel);
    }

    if (found.length) break;

    currentLevel = nextLevel;
  }

  return found;
};

export const findSteamSettingsDirectories = async (executablePath: string) => {
  if (isUnsafePath(path.dirname(executablePath))) return [];

  const containmentRoot = await resolveContainmentRoot(executablePath);

  if (!containmentRoot) return [];

  const emulatorDirectories = await collectEmulatorDirectories(executablePath);

  const directories = new Set<string>();

  await Promise.all(
    emulatorDirectories.flatMap((emulatorDirectory) =>
      STEAM_SETTINGS_RELATIVE_PATHS.map(async (segments) => {
        const candidate = path.join(emulatorDirectory, ...segments);
        const resolved = await resolveContainedDirectory(
          containmentRoot,
          candidate
        );

        if (resolved) directories.add(resolved);
      })
    )
  );

  if (directories.size) return [...directories];

  for (const directory of await searchBreadthFirst(containmentRoot)) {
    const resolved = await resolveContainedDirectory(
      containmentRoot,
      directory
    );

    if (resolved) directories.add(resolved);
  }

  return [...directories];
};
