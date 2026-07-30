import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { logger } from "./logger";
import { getSteamLocation } from "./steam";
import {
  isFlatpakSteamInstalled,
  isInsideSteamLibrary,
  resolveSteamBinaryPath,
} from "./steam-library";
import { SystemPath } from "./system-path";
import { WindowManager } from "./window-manager";

const STEAM_EMULATOR_MARKER_FILES = [
  "onlinefix64.dll",
  "onlinefix.dll",
  "onlinefix.ini",
];

const PROXY_DLL_PATTERN =
  /^(?:emp|custom|dinput8|dsound|dnet|version)\.dll$|^win.*\.dll$|^(?:online|steam).*\.dll$|^eos.*\.dll$|^epicfix.*\.dll$/;

const UNSUPPORTED_STEAMWORKS_FILE = "steam_api.txt";

const DLL_LIST_FILES = new Set(["winmm.txt", "dlllist.txt"]);

const NATIVE_BUILTIN_DLL_PATTERN = /^(?:win|dinput|dsound|version)/;

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

const PREFIX_STEAM_DIRECTORY = path.join(
  "drive_c",
  "Program Files (x86)",
  "Steam"
);

const STEAM_STARTUP_TIMEOUT_MS = 60_000;

const STEAM_STARTUP_POLL_INTERVAL_MS = 1000;

const STEAM_STARTUP_SETTLE_MS = 5000;

export type SteamClientStartupStatus = "starting" | "ready" | "failed";

export interface SteamClientDetection {
  usesSteamworks: boolean;
  hasBundledEmulator: boolean;
  dllOverrides: string;
}

export interface SteamClientCompatOptions {
  executablePath: string;
  winePrefixPath: string | null;
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

const readListedModules = (filePath: string) => {
  try {
    return fs
      .readFileSync(filePath, "utf-8")
      .split(/\r?\n/)
      .map((line) => line.trim().replaceAll("\\", "/").toLowerCase())
      .filter((line) => line.endsWith(".dll"))
      .map((line) => path.basename(line, ".dll"))
      .filter(Boolean);
  } catch {
    return [];
  }
};

const collectProxyDllOverrides = (gameDirectory: string) => {
  let remainingEntries = MAX_SCANNED_ENTRIES;

  const overrides = new Map<string, string>();
  const listFiles: string[] = [];

  const scan = (directoryPath: string, depth: number) => {
    if (depth > MAX_SCAN_DEPTH || remainingEntries <= 0) return;

    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    const subdirectories: string[] = [];

    for (const entry of entries) {
      if (remainingEntries-- <= 0) return;

      if (entry.isDirectory()) {
        subdirectories.push(entry.name);
        continue;
      }

      const entryName = entry.name.toLowerCase();

      if (DLL_LIST_FILES.has(entryName)) {
        listFiles.push(path.join(directoryPath, entry.name));
        continue;
      }

      if (!PROXY_DLL_PATTERN.test(entryName)) continue;

      const moduleName = path.basename(entryName, ".dll");

      overrides.set(
        moduleName,
        NATIVE_BUILTIN_DLL_PATTERN.test(moduleName) ? "n,b" : "n"
      );
    }

    for (const subdirectory of subdirectories) {
      scan(path.join(directoryPath, subdirectory), depth + 1);
    }
  };

  scan(gameDirectory, 0);

  for (const listFile of listFiles) {
    for (const moduleName of readListedModules(listFile)) {
      if (!overrides.has(moduleName)) overrides.set(moduleName, "n");
    }
  }

  return [...overrides.entries()]
    .map(([moduleName, mode]) => `${moduleName}=${mode}`)
    .join(";");
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
    ? collectProxyDllOverrides(gameDirectory)
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

const notifySteamClientStatus = (status: SteamClientStartupStatus) => {
  WindowManager.gameLauncherWindow?.webContents.send("steam-client-progress", {
    status,
  });
};

const startSteamClient = () => {
  const steamBinaryPath = resolveSteamBinaryPath();

  if (!steamBinaryPath) {
    logger.warn("Could not find the Steam binary to start the Steam client");
    return false;
  }

  try {
    const steamProcess = spawn(steamBinaryPath, ["-silent"], {
      detached: true,
      stdio: "ignore",
    });

    steamProcess.on("error", (error) =>
      logger.error("Failed to start the Steam client", { error })
    );

    steamProcess.unref();

    return true;
  } catch (error) {
    logger.error("Failed to start the Steam client", { error });
    return false;
  }
};

const waitForSteamClient = async () => {
  const deadline = performance.now() + STEAM_STARTUP_TIMEOUT_MS;

  while (performance.now() < deadline) {
    notifySteamClientStatus("starting");

    await new Promise((resolve) =>
      setTimeout(resolve, STEAM_STARTUP_POLL_INTERVAL_MS)
    );

    if (isSteamClientRunning()) return true;
  }

  return false;
};

const ensureSteamClientRunning = async () => {
  if (isSteamClientRunning()) return true;

  if (isFlatpakSteamInstalled()) {
    logger.warn(
      "Steam is installed as a flatpak and no other client is running, skipping the Steam client setup"
    );
    return false;
  }

  logger.info("Starting the Steam client for a game that requires it");

  if (!startSteamClient()) return false;

  notifySteamClientStatus("starting");

  const started = await waitForSteamClient();

  if (!started) {
    notifySteamClientStatus("failed");
    return false;
  }

  await new Promise((resolve) => setTimeout(resolve, STEAM_STARTUP_SETTLE_MS));

  notifySteamClientStatus("ready");

  return true;
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

const removeSteamClientFiles = (
  steamInstallPath: string,
  winePrefixPath: string
) => {
  const legacyCompatPath = path.join(steamInstallPath, LEGACY_COMPAT_DIRECTORY);
  const targetDirectory = path.join(winePrefixPath, PREFIX_STEAM_DIRECTORY);

  const removedFiles: string[] = [];

  for (const [sourceName, targetName] of STEAM_CLIENT_FILES) {
    const sourceFilePath = path.join(legacyCompatPath, sourceName);
    const targetFilePath = path.join(targetDirectory, targetName);

    if (!isCopyUpToDate(sourceFilePath, targetFilePath)) continue;

    try {
      fs.rmSync(targetFilePath);
      removedFiles.push(targetName);
    } catch {
      continue;
    }
  }

  return removedFiles;
};

const readConfigEntries = (gameDirectory: string) => {
  try {
    return fs
      .readdirSync(gameDirectory)
      .filter((entry) => STEAM_EMULATOR_CONFIG_FILES.has(entry.toLowerCase()));
  } catch {
    return [];
  }
};

const readConfiguredOverlayGameId = (executablePath: string) => {
  const gameDirectory = path.dirname(executablePath);

  for (const configEntry of readConfigEntries(gameDirectory)) {
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

const warnAboutUnsupportedSteamworksFile = (executablePath: string) => {
  const unsupportedFilePath = path.join(
    path.dirname(executablePath),
    UNSUPPORTED_STEAMWORKS_FILE
  );

  if (!fs.existsSync(unsupportedFilePath)) return;

  logger.warn(
    "The game folder contains a file that is known to send the launch to the Steam store, the game may refuse to start",
    { unsupportedFilePath }
  );
};

const resolveOverlayEnv = (
  steamInstallPath: string,
  executablePath: string
): Record<string, string> => {
  const libraryPaths = OVERLAY_LIBRARIES.map((library) =>
    path.join(steamInstallPath, library)
  ).filter((libraryPath) => fs.existsSync(libraryPath));

  if (!libraryPaths.length) return {};

  const overlayGameId =
    readConfiguredOverlayGameId(executablePath) ?? FALLBACK_OVERLAY_GAME_ID;

  return {
    LD_PRELOAD: `:${libraryPaths.join(":")}`,
    ENABLE_VK_LAYER_VALVE_steam_overlay_1: "1",
    SteamOverlayGameId: overlayGameId,
  };
};

export const resolveSteamClientCompatEnv = async ({
  executablePath,
  winePrefixPath,
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
      {
        executablePath,
        steamInstallPath,
        hasFlatpakSteam: isFlatpakSteamInstalled(),
      }
    );
    return null;
  }

  if (!(await ensureSteamClientRunning())) {
    const removedFiles = removeSteamClientFiles(
      steamInstallPath,
      winePrefixPath
    );

    logger.warn(
      "Game requires the Steam client but it could not be started, launching the game without the Steam client setup",
      {
        executablePath,
        hasFlatpakSteam: isFlatpakSteamInstalled(),
        removedFiles,
      }
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

  if (hasBundledEmulator) {
    warnAboutUnsupportedSteamworksFile(executablePath);
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
      ? resolveOverlayEnv(steamInstallPath, executablePath)
      : {}),
    ...(dllOverrides ? { WINEDLLOVERRIDES: dllOverrides } : {}),
  };
};
