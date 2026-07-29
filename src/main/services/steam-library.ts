import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";

import { logger } from "./logger";
import { SystemPath } from "./system-path";

const STEAM_APPS_DIRECTORY = "steamapps";

const STEAM_INSTALL_DIRECTORIES = [
  [".steam", "steam"],
  [".local", "share", "Steam"],
  [".var", "app", "com.valvesoftware.Steam"],
];

const STEAM_BINARY_NAME = "steam";

const STEAM_LIBRARY_SEGMENT = `${path.sep}${STEAM_APPS_DIRECTORY}${path.sep}common${path.sep}`;

const APP_MANIFEST_PREFIX = "appmanifest_";

const APP_MANIFEST_SUFFIX = ".acf";

const COMPAT_DATA_DIRECTORY = "compatdata";

const PREFIX_DIRECTORY = "pfx";

export interface SteamLaunchInfo {
  appId: string;
  winePrefixPath: string | null;
}

export const isInsideSteamLibrary = (executablePath: string) =>
  executablePath.toLowerCase().includes(STEAM_LIBRARY_SEGMENT);

const resolveSteamAppsPath = (executablePath: string) => {
  const segmentIndex = executablePath
    .toLowerCase()
    .indexOf(STEAM_LIBRARY_SEGMENT);

  if (segmentIndex === -1) return null;

  return executablePath.slice(
    0,
    segmentIndex + STEAM_APPS_DIRECTORY.length + path.sep.length
  );
};

const resolveInstallDirectory = (
  steamAppsPath: string,
  executablePath: string
) => {
  const relativePath = path.relative(
    path.join(steamAppsPath, "common"),
    executablePath
  );

  const [installDirectory] = relativePath.split(path.sep);

  return installDirectory || null;
};

const readManifestValue = (contents: string, key: string) =>
  new RegExp(`"${key}"\\s*"([^"]*)"`, "i").exec(contents)?.[1] ?? null;

export const resolveSteamAppId = (executablePath: string): string | null => {
  const steamAppsPath = resolveSteamAppsPath(executablePath);

  if (!steamAppsPath) return null;

  const installDirectory = resolveInstallDirectory(
    steamAppsPath,
    executablePath
  );

  if (!installDirectory) return null;

  let manifestFiles: string[];

  try {
    manifestFiles = fs
      .readdirSync(steamAppsPath)
      .filter(
        (entry) =>
          entry.startsWith(APP_MANIFEST_PREFIX) &&
          entry.endsWith(APP_MANIFEST_SUFFIX)
      );
  } catch {
    return null;
  }

  for (const manifestFile of manifestFiles) {
    try {
      const contents = fs.readFileSync(
        path.join(steamAppsPath, manifestFile),
        "utf-8"
      );

      const manifestInstallDirectory = readManifestValue(
        contents,
        "installdir"
      );

      if (
        manifestInstallDirectory?.toLowerCase() !==
        installDirectory.toLowerCase()
      ) {
        continue;
      }

      const appId = readManifestValue(contents, "appid");

      if (appId) return appId;
    } catch {
      continue;
    }
  }

  return null;
};

const resolveSteamPrefixPath = (executablePath: string, appId: string) => {
  const steamAppsPath = resolveSteamAppsPath(executablePath);

  if (!steamAppsPath) return null;

  const prefixPath = path.join(
    steamAppsPath,
    COMPAT_DATA_DIRECTORY,
    appId,
    PREFIX_DIRECTORY
  );

  return fs.existsSync(prefixPath) ? prefixPath : null;
};

export const resolveSteamLaunchInfo = (
  executablePath: string
): SteamLaunchInfo | null => {
  const appId = resolveSteamAppId(executablePath);

  if (!appId) return null;

  return {
    appId,
    winePrefixPath: resolveSteamPrefixPath(executablePath, appId),
  };
};

const isSteamBinaryOnPath = () =>
  (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((directory) => {
      try {
        fs.accessSync(
          path.join(directory, STEAM_BINARY_NAME),
          fs.constants.X_OK
        );
        return true;
      } catch {
        return false;
      }
    });

export const isSteamAvailable = () => {
  const homePath = SystemPath.getPath("home");

  const hasInstallDirectory = STEAM_INSTALL_DIRECTORIES.some((segments) =>
    fs.existsSync(path.join(homePath, ...segments))
  );

  return hasInstallDirectory || isSteamBinaryOnPath();
};

export const launchThroughSteam = async (appId: string) => {
  if (!isSteamAvailable()) {
    logger.warn(
      "The game is inside a Steam library but Steam is not installed, skipping the handover",
      { appId }
    );
    return false;
  }

  try {
    await shell.openExternal(`steam://rungameid/${appId}`);
    return true;
  } catch (error) {
    logger.error("Failed to launch the game through Steam", { appId, error });
    return false;
  }
};
