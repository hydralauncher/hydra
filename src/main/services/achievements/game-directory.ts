import path from "node:path";
import fs from "node:fs";

import { isUnsafePath } from "../../events/helpers/find-game-root.js";

export const STEAM_SETTINGS_DIR_NAME = "steam_settings";
export const ACHIEVEMENTS_FILE_NAME = "achievements.json";

const MAX_UPWARD_LEVELS = 3;

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

export const readDirectorySafe = async (dirPath: string) => {
  try {
    return await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }
};

export const isDirectory = async (dirPath: string) => {
  try {
    return (await fs.promises.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
};

export const isFile = async (filePath: string) => {
  try {
    return (await fs.promises.stat(filePath)).isFile();
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

const WINDOWS_BINARY_DIR_NAMES = ["Win64", "Win32", "WinGDK"];
const UNITY_PLUGIN_DIR_NAMES = ["x86_64", "x86"];

const collectLayoutDirectories = async (searchRoot: string) => {
  const directories: string[] = [];

  const entries = await readDirectorySafe(searchRoot);

  for (const entry of entries ?? []) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;

    if (NESTED_EXECUTABLE_DIRS.has(name.toLowerCase())) {
      directories.push(path.join(searchRoot, name));
    }

    for (const architecture of WINDOWS_BINARY_DIR_NAMES) {
      directories.push(path.join(searchRoot, name, "Binaries", architecture));
    }

    if (name.toLowerCase().endsWith("_data")) {
      for (const architecture of UNITY_PLUGIN_DIR_NAMES) {
        directories.push(path.join(searchRoot, name, "Plugins", architecture));
      }
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

    for (const architecture of WINDOWS_BINARY_DIR_NAMES) {
      directories.push(path.join(steamworksPath, entry.name, architecture));
    }
  }

  return directories;
};

export const collectEmulatorDirectories = async (executablePath: string) => {
  const executableDirectory = path.dirname(executablePath);

  if (isUnsafePath(executableDirectory)) return [];

  const searchRoot = await resolveGameSearchRoot(executablePath);

  return [
    ...new Set(
      [
        executableDirectory,
        searchRoot,
        ...(await collectLayoutDirectories(searchRoot)),
      ].map((directory) => path.resolve(directory))
    ),
  ];
};

export const resolveGameSearchRoot = async (executablePath: string) => {
  let searchRoot = path.dirname(executablePath);

  for (let level = 0; level < MAX_UPWARD_LEVELS; level++) {
    const parent = path.dirname(searchRoot);

    if (parent === searchRoot || isUnsafePath(parent)) break;

    const entries = await readDirectorySafe(parent);

    if (!entries) break;

    const currentIsNestedExecutableDir = NESTED_EXECUTABLE_DIRS.has(
      path.basename(searchRoot).toLowerCase()
    );

    if (!currentIsNestedExecutableDir && !hasGameRootMarker(entries)) break;

    searchRoot = parent;
  }

  return searchRoot;
};
