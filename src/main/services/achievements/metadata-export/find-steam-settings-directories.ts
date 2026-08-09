import path from "node:path";

import { isUnsafePath } from "../../../events/helpers/find-game-root.js";
import {
  STEAM_SETTINGS_DIR_NAME,
  isDirectory,
  readDirectorySafe,
  resolveGameSearchRoot,
} from "../game-directory.js";

const MAX_DEPTH = 8;
const MAX_DIRECTORIES_VISITED = 2000;

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

const collectProbeCandidates = async (
  searchRoot: string,
  executableDirectory: string
) => {
  const candidates = [
    path.join(executableDirectory, STEAM_SETTINGS_DIR_NAME),
    path.join(searchRoot, STEAM_SETTINGS_DIR_NAME),
  ];

  const entries = await readDirectorySafe(searchRoot);

  for (const entry of entries ?? []) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;

    if (name.toLowerCase().endsWith("_data")) {
      for (const architecture of ["x86_64", "x86"]) {
        candidates.push(
          path.join(
            searchRoot,
            name,
            "Plugins",
            architecture,
            STEAM_SETTINGS_DIR_NAME
          )
        );
      }
    }

    for (const architecture of ["Win64", "Win32", "WinGDK"]) {
      candidates.push(
        path.join(
          searchRoot,
          name,
          "Binaries",
          architecture,
          STEAM_SETTINGS_DIR_NAME
        )
      );
    }
  }

  const steamworksPath = path.join(
    searchRoot,
    "Engine",
    "Binaries",
    "ThirdParty",
    "Steamworks"
  );

  const steamworksEntries = await readDirectorySafe(steamworksPath);

  for (const entry of steamworksEntries ?? []) {
    if (!entry.isDirectory()) continue;

    for (const architecture of ["Win64", "Win32"]) {
      candidates.push(
        path.join(
          steamworksPath,
          entry.name,
          architecture,
          STEAM_SETTINGS_DIR_NAME
        )
      );
    }
  }

  return candidates;
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
  const executableDirectory = path.dirname(executablePath);

  if (isUnsafePath(executableDirectory)) return [];

  const searchRoot = await resolveGameSearchRoot(executablePath);

  const probeCandidates = await collectProbeCandidates(
    searchRoot,
    executableDirectory
  );

  const directories = new Set<string>();

  for (const candidate of probeCandidates) {
    if (await isDirectory(candidate)) {
      directories.add(path.resolve(candidate));
    }
  }

  if (directories.size) return [...directories];

  for (const directory of await searchBreadthFirst(searchRoot)) {
    directories.add(path.resolve(directory));
  }

  return [...directories];
};
