import fs from "node:fs";
import path from "node:path";

import { logger } from "./logger";
import { getSteamLocation } from "./steam";
import { isInsideSteamLibrary } from "./steam-library";
import { SystemPath } from "./system-path";

const STEAM_EMULATOR_MARKER_FILES = [
  "onlinefix64.dll",
  "onlinefix.dll",
  "onlinefix.ini",
];

const STEAM_EMULATOR_PROXY_DLLS = [
  "winmm.dll",
  "dinput8.dll",
  "dsound.dll",
  "version.dll",
];

const STEAM_EMULATOR_CONFIG_FILES = new Set(["onlinefix.ini", "steamfix.ini"]);

const OVERLAY_GAME_ID_KEY = "FakeAppId";

const STEAMWORKS_FILES = new Set([
  "steam_api64.dll",
  "steam_api.dll",
  "steam_appid.txt",
]);

const MAX_SCAN_DEPTH = 8;

const MAX_SCANNED_ENTRIES = 8000;

const STEAM_CLIENT_FILES: [string, string][] = [
  ["steamclient.dll", "steamclient.dll"],
  ["steamclient64.dll", "steamclient64.dll"],
  ["GameOverlayRenderer64.dll", "GameOverlayRenderer64.dll"],
  ["SteamService.exe", "steam.exe"],
  ["Steam.dll", "Steam.dll"],
];

const REQUIRED_STEAM_CLIENT_FILE = "steamclient64.dll";

const LEGACY_COMPAT_DIRECTORY = "legacycompat";

const OVERLAY_LIBRARIES = [
  path.join("ubuntu12_32", "gameoverlayrenderer.so"),
  path.join("ubuntu12_64", "gameoverlayrenderer.so"),
];

const FALLBACK_OVERLAY_GAME_ID = "480";

const NUMERIC_APP_ID_PATTERN = /^\d+$/;

const PREFIX_STEAM_DIRECTORY = path.join(
  "drive_c",
  "Program Files (x86)",
  "Steam"
);

export interface SteamClientDetection {
  usesSteamworks: boolean;
  hasBundledEmulator: boolean;
  dllOverrides: string;
}

export interface SteamClientCompatOptions {
  executablePath: string;
  winePrefixPath: string | null;
  objectId?: string | null;
}

const readDirectoryEntries = (directoryPath: string) => {
  try {
    return fs.readdirSync(directoryPath).map((entry) => entry.toLowerCase());
  } catch {
    return [];
  }
};

const containsSteamworksFiles = (gameDirectory: string) => {
  let remainingEntries = MAX_SCANNED_ENTRIES;

  const scan = (directoryPath: string, depth: number): boolean => {
    if (depth > MAX_SCAN_DEPTH || remainingEntries <= 0) return false;

    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    } catch {
      return false;
    }

    const subdirectories: string[] = [];

    for (const entry of entries) {
      if (remainingEntries-- <= 0) return false;

      if (entry.isDirectory()) {
        subdirectories.push(entry.name);
        continue;
      }

      if (STEAMWORKS_FILES.has(entry.name.toLowerCase())) return true;
    }

    return subdirectories.some((subdirectory) =>
      scan(path.join(directoryPath, subdirectory), depth + 1)
    );
  };

  return scan(gameDirectory, 0);
};

export const detectSteamClientUsage = (
  executablePath: string
): SteamClientDetection => {
  const gameDirectory = path.dirname(executablePath);
  const entries = new Set(readDirectoryEntries(gameDirectory));

  const hasBundledEmulator = STEAM_EMULATOR_MARKER_FILES.some((markerFile) =>
    entries.has(markerFile)
  );

  const usesSteamworks =
    hasBundledEmulator ||
    isInsideSteamLibrary(executablePath) ||
    containsSteamworksFiles(gameDirectory);

  if (!usesSteamworks) {
    return {
      usesSteamworks: false,
      hasBundledEmulator: false,
      dllOverrides: "",
    };
  }

  const dllOverrides = hasBundledEmulator
    ? STEAM_EMULATOR_PROXY_DLLS.filter((proxyDll) => entries.has(proxyDll))
        .map((proxyDll) => `${path.basename(proxyDll, ".dll")}=n,b`)
        .join(";")
    : "";

  return { usesSteamworks, hasBundledEmulator, dllOverrides };
};

export const isSteamClientRunning = () => {
  const pidFilePath = path.join(
    SystemPath.getPath("home"),
    ".steam",
    "steam.pid"
  );

  try {
    const pid = Number.parseInt(
      fs.readFileSync(pidFilePath, "utf-8").trim(),
      10
    );

    if (!Number.isInteger(pid) || pid <= 0) return false;

    return fs.existsSync(path.join("/proc", String(pid)));
  } catch {
    return false;
  }
};

const isCopyUpToDate = (sourceFilePath: string, targetFilePath: string) => {
  try {
    const source = fs.statSync(sourceFilePath);
    const target = fs.statSync(targetFilePath);

    return source.size === target.size && target.mtimeMs >= source.mtimeMs;
  } catch {
    return false;
  }
};

const copySteamClientFiles = (
  steamInstallPath: string,
  winePrefixPath: string
) => {
  const legacyCompatPath = path.join(steamInstallPath, LEGACY_COMPAT_DIRECTORY);
  const targetDirectory = path.join(winePrefixPath, PREFIX_STEAM_DIRECTORY);

  fs.mkdirSync(targetDirectory, { recursive: true });

  for (const [sourceName, targetName] of STEAM_CLIENT_FILES) {
    const sourceFilePath = path.join(legacyCompatPath, sourceName);

    if (!fs.existsSync(sourceFilePath)) continue;

    const targetFilePath = path.join(targetDirectory, targetName);

    if (isCopyUpToDate(sourceFilePath, targetFilePath)) continue;

    fs.copyFileSync(sourceFilePath, targetFilePath);
  }
};

const readConfiguredOverlayGameId = (executablePath: string) => {
  const gameDirectory = path.dirname(executablePath);

  let entries: string[];

  try {
    entries = fs.readdirSync(gameDirectory);
  } catch {
    return null;
  }

  const configEntries = entries.filter((entry) =>
    STEAM_EMULATOR_CONFIG_FILES.has(entry.toLowerCase())
  );

  for (const configEntry of configEntries) {
    try {
      const contents = fs.readFileSync(
        path.join(gameDirectory, configEntry),
        "utf-8"
      );

      const value = new RegExp(
        String.raw`^\s*${OVERLAY_GAME_ID_KEY}\s*=\s*(\d+)\s*$`,
        "im"
      ).exec(contents)?.[1];

      if (value) return value;
    } catch {
      continue;
    }
  }

  return null;
};

const resolveOverlayEnv = (
  steamInstallPath: string,
  executablePath: string,
  objectId?: string | null
): Record<string, string> => {
  const libraryPaths = OVERLAY_LIBRARIES.map((library) =>
    path.join(steamInstallPath, library)
  ).filter((libraryPath) => fs.existsSync(libraryPath));

  if (!libraryPaths.length) return {};

  const numericObjectId =
    objectId && NUMERIC_APP_ID_PATTERN.test(objectId) ? objectId : null;

  const overlayGameId =
    readConfiguredOverlayGameId(executablePath) ??
    numericObjectId ??
    FALLBACK_OVERLAY_GAME_ID;

  return {
    LD_PRELOAD: `:${libraryPaths.join(":")}`,
    ENABLE_VK_LAYER_VALVE_steam_overlay_1: "1",
    SteamOverlayGameId: overlayGameId,
  };
};

export const resolveSteamClientCompatEnv = async ({
  executablePath,
  winePrefixPath,
  objectId,
}: SteamClientCompatOptions): Promise<Record<string, string> | null> => {
  if (process.platform !== "linux") return null;

  const { usesSteamworks, hasBundledEmulator, dllOverrides } =
    detectSteamClientUsage(executablePath);

  if (!usesSteamworks) return null;

  if (!winePrefixPath) {
    logger.warn(
      "Game requires the Steam client but no wine prefix is configured, skipping Steam client setup",
      { executablePath }
    );
    return null;
  }

  const steamInstallPath = await getSteamLocation().catch(() => null);

  const requiredFilePath = steamInstallPath
    ? path.join(
        steamInstallPath,
        LEGACY_COMPAT_DIRECTORY,
        REQUIRED_STEAM_CLIENT_FILE
      )
    : null;

  if (
    !steamInstallPath ||
    !requiredFilePath ||
    !fs.existsSync(requiredFilePath)
  ) {
    logger.warn(
      "Game requires the Steam client but the Steam client files were not found, skipping Steam client setup",
      { executablePath, steamInstallPath }
    );
    return null;
  }

  try {
    copySteamClientFiles(steamInstallPath, winePrefixPath);
  } catch (error) {
    logger.error("Failed to copy the Steam client files into the wine prefix", {
      winePrefixPath,
      error,
    });
    return null;
  }

  if (!isSteamClientRunning()) {
    logger.warn(
      "Game requires the Steam client but it is not running, the game will likely fail to initialize Steam",
      { executablePath }
    );
  }

  logger.info("Enabling Steam client compatibility", {
    executablePath,
    steamInstallPath,
    winePrefixPath,
    hasBundledEmulator,
    dllOverrides,
  });

  return {
    STEAM_COMPAT_CLIENT_INSTALL_PATH: steamInstallPath,
    ...(hasBundledEmulator
      ? resolveOverlayEnv(steamInstallPath, executablePath, objectId)
      : {}),
    ...(dllOverrides ? { WINEDLLOVERRIDES: dllOverrides } : {}),
  };
};
