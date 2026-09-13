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

export const realPathOrNull = async (target: string) => {
  try {
    return await fs.promises.realpath(target);
  } catch {
    return null;
  }
};

export const isWithin = (root: string, target: string) => {
  const relative = path.relative(root, target);

  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};

export const resolveContainedDirectory = async (
  containmentRoot: string,
  candidate: string
) => {
  const resolved = await realPathOrNull(candidate);

  if (!resolved) return null;
  if (!isWithin(containmentRoot, resolved)) return null;
  if (!(await isDirectory(resolved))) return null;

  return resolved;
};

export const createContainedDirectory = async (
  root: string,
  relativePath: string
) => {
  let current = root;

  for (const segment of relativePath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return null;

    current = path.join(current, segment);

    try {
      await fs.promises.mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
    }

    const resolved = await realPathOrNull(current);

    if (!resolved || !isWithin(root, resolved)) return null;
    if (!(await isDirectory(resolved))) return null;

    current = resolved;
  }

  return current;
};

export const resolveContainmentRoot = async (executablePath: string) => {
  const searchRoot = await resolveGameSearchRoot(executablePath);

  return realPathOrNull(searchRoot);
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

const collectSubdirectoryLayouts = (searchRoot: string, name: string) => {
  const directories: string[] = [];

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

  return directories;
};

const collectSteamworksLayouts = async (searchRoot: string) => {
  const steamworksPath = path.join(
    searchRoot,
    "Engine",
    "Binaries",
    "ThirdParty",
    "Steamworks"
  );

  const entries = await readDirectorySafe(steamworksPath);

  return (entries ?? [])
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      WINDOWS_BINARY_DIR_NAMES.map((architecture) =>
        path.join(steamworksPath, entry.name, architecture)
      )
    );
};

const collectLayoutDirectories = async (searchRoot: string) => {
  const entries = await readDirectorySafe(searchRoot);

  const subdirectoryLayouts = (entries ?? [])
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => collectSubdirectoryLayouts(searchRoot, entry.name));

  return [
    ...subdirectoryLayouts,
    ...(await collectSteamworksLayouts(searchRoot)),
  ];
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
