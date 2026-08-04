import path from "node:path";
import fs from "node:fs";

import { isUnsafePath } from "../../../events/helpers/find-game-root.js";

const STEAM_SETTINGS_DIR_NAME = "steam_settings";

const MAX_UPWARD_LEVELS = 3;
const MAX_DEPTH = 8;
const MAX_DIRECTORIES_VISITED = 2000;

const NESTED_EXECUTABLE_DIRS = new Set([
  "bin",
  "bin32",
  "bin64",
  "binaries",
  "win32",
  "win64",
  "x64",
  "x86",
  "game",
  "runtime",
]);

const GAME_ROOT_MARKER_DIRS = new Set([
  "engine",
  "binaries",
  "content",
  "plugins",
]);

const GAME_ROOT_MARKER_FILES = new Set([
  "steam_api.dll",
  "steam_api64.dll",
  "steam_appid.txt",
]);

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

const readDirectory = async (dirPath: string) => {
  try {
    return await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }
};

const isDirectory = async (dirPath: string) => {
  try {
    return (await fs.promises.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
};

const hasGameRootMarker = (entries: fs.Dirent[]) =>
  entries.some((entry) => {
    const name = entry.name.toLowerCase();

    if (entry.isDirectory()) {
      return (
        GAME_ROOT_MARKER_DIRS.has(name) ||
        name.endsWith("_data") ||
        name === STEAM_SETTINGS_DIR_NAME
      );
    }

    return GAME_ROOT_MARKER_FILES.has(name);
  });

/**
 * Walks up from the executable directory looking for the outermost directory
 * that still belongs to the game. Unreal Engine keeps the Steamworks DLL three
 * levels away from the shipping executable, so the search has to start above
 * the executable directory. A plain `.exe` is deliberately not treated as a
 * marker, otherwise a stray executable inside a games library folder would
 * turn that whole library into the search root.
 */
const resolveSearchRoot = async (executableDirectory: string) => {
  let searchRoot = executableDirectory;

  for (let level = 0; level < MAX_UPWARD_LEVELS; level++) {
    const parent = path.dirname(searchRoot);

    if (parent === searchRoot || isUnsafePath(parent)) break;

    const entries = await readDirectory(parent);

    if (!entries) break;

    const currentIsNestedExecutableDir = NESTED_EXECUTABLE_DIRS.has(
      path.basename(searchRoot).toLowerCase()
    );

    if (!currentIsNestedExecutableDir && !hasGameRootMarker(entries)) break;

    searchRoot = parent;
  }

  return searchRoot;
};

/**
 * Known layouts where emulators are shipped, probed before falling back to a
 * breadth-first search so that the common cases never walk the whole game.
 */
const collectProbeCandidates = async (
  searchRoot: string,
  executableDirectory: string
) => {
  const candidates = [
    path.join(executableDirectory, STEAM_SETTINGS_DIR_NAME),
    path.join(searchRoot, STEAM_SETTINGS_DIR_NAME),
  ];

  const entries = await readDirectory(searchRoot);

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

  const steamworksEntries = await readDirectory(steamworksPath);

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

      const entries = await readDirectory(dirPath);

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

/**
 * Finds every `steam_settings` directory that belongs to the game the given
 * executable is part of. Hydra never creates one: its presence is what tells us
 * a Steam emulator is installed alongside the game.
 */
export const findSteamSettingsDirectories = async (executablePath: string) => {
  const executableDirectory = path.dirname(executablePath);

  if (isUnsafePath(executableDirectory)) return [];

  const searchRoot = await resolveSearchRoot(executableDirectory);

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
