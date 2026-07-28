import fs from "node:fs";
import path from "node:path";

import { logger } from "./logger";
import { getSteamLocation } from "./steam";
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

const STEAM_CLIENT_FILES: [string, string][] = [
  ["steamclient.dll", "steamclient.dll"],
  ["steamclient64.dll", "steamclient64.dll"],
  ["GameOverlayRenderer64.dll", "GameOverlayRenderer64.dll"],
  ["SteamService.exe", "steam.exe"],
  ["Steam.dll", "Steam.dll"],
];

const REQUIRED_STEAM_CLIENT_FILE = "steamclient64.dll";

const LEGACY_COMPAT_DIRECTORY = "legacycompat";

const PREFIX_STEAM_DIRECTORY = path.join(
  "drive_c",
  "Program Files (x86)",
  "Steam"
);

export interface SteamEmulatorDetection {
  detected: boolean;
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

export const detectBundledSteamEmulator = (
  executablePath: string
): SteamEmulatorDetection => {
  const entries = new Set(readDirectoryEntries(path.dirname(executablePath)));

  const detected = STEAM_EMULATOR_MARKER_FILES.some((markerFile) =>
    entries.has(markerFile)
  );

  if (!detected) {
    return { detected: false, dllOverrides: "" };
  }

  const dllOverrides = STEAM_EMULATOR_PROXY_DLLS.filter((proxyDll) =>
    entries.has(proxyDll)
  )
    .map((proxyDll) => `${path.basename(proxyDll, ".dll")}=n,b`)
    .join(";");

  return { detected: true, dllOverrides };
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

export const resolveSteamClientCompatEnv = async ({
  executablePath,
  winePrefixPath,
}: SteamClientCompatOptions): Promise<Record<string, string> | null> => {
  if (process.platform !== "linux") return null;

  const { detected, dllOverrides } = detectBundledSteamEmulator(executablePath);

  if (!detected) return null;

  if (!winePrefixPath) {
    logger.warn(
      "Bundled Steam emulator detected but no wine prefix is configured, skipping Steam client setup",
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
      "Bundled Steam emulator detected but the Steam client files were not found, skipping Steam client setup",
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
      "Bundled Steam emulator detected but the Steam client is not running, the game will likely fail to initialize Steam",
      { executablePath }
    );
  }

  logger.info(
    "Enabling Steam client compatibility for a bundled Steam emulator",
    {
      executablePath,
      steamInstallPath,
      winePrefixPath,
      dllOverrides,
    }
  );

  return {
    STEAM_COMPAT_CLIENT_INSTALL_PATH: steamInstallPath,
    ...(dllOverrides ? { WINEDLLOVERRIDES: dllOverrides } : {}),
  };
};
