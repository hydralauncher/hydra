import path from "node:path";
import fs from "node:fs";

import { isUnsafePath } from "../../events/helpers/find-game-root.js";

export const STEAM_SETTINGS_DIR_NAME = "steam_settings";

const MAX_UPWARD_LEVELS = 3;

export const NESTED_EXECUTABLE_DIRS = new Set([
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
