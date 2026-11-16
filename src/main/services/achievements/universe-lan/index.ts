import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import axios from "axios";
import type { UserPreferences } from "@types";

import { db, levelKeys } from "@main/level";
import { achievementsLogger } from "../../logger";
import { SevenZip } from "../../7zip";
import { SystemPath } from "../../system-path";
import { gamesPlaytime } from "../../game-running-state";
import { launchedGamePids } from "../../launched-game-pids";
import { resolveGameDirectoryLocations } from "../scan-game-directory-achievement-files";
import { UNIVERSE_LAN_DIR_NAME } from "../universe-lan-locations";
import {
  AUTHENTICATION_KEY_NAME,
  buildBootFile,
  buildClientConfig,
  buildServerConfig,
  generateAuthenticationKey,
  readIniValue,
} from "./config";
import { findGalaxyDlls, type GalaxyDll } from "./galaxy-dll";
import {
  installUniverseLanDll,
  isHydraInstalled,
  readInstallMarker,
  restoreGalaxyDll,
} from "./install";
import {
  UNIVERSE_LAN_RELEASES_URL,
  assertPackageIntegrity,
  selectUniverseLanPackage,
  type GitHubRelease,
} from "./release";
import { UniverseLanServerManager } from "./server";

const PACKAGE_CACHE_PATH = path.join(
  SystemPath.getPath("userData"),
  UNIVERSE_LAN_DIR_NAME
);
const PACKAGE_METADATA_FILE_NAME = "hydra-package.json";
const BOOT_FILE_NAME = "UniverseLAN.ini";
const CLIENT_CONFIG_FILE_NAME = "Config.ini";
const RELEASES_TIMEOUT_IN_MS = 15_000;
const DOWNLOAD_TIMEOUT_IN_MS = 60_000;
const MAX_PACKAGE_SIZE_IN_BYTES = 50 * 1024 * 1024;

const REQUIRED_PACKAGE_FILES = [
  "Galaxy.dll",
  "Galaxy64.dll",
  "UniverseLANServer.exe",
  "UniverseLANServer64.exe",
  BOOT_FILE_NAME,
  path.join("UniverseLANData", CLIENT_CONFIG_FILE_NAME),
  path.join("UniverseLANServerData", CLIENT_CONFIG_FILE_NAME),
];

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * A game counts as running while the process watcher tracks it or while the
 * process Hydra started is alive (covers launchers the watcher doesn't match).
 */
const isGameRunning = (gameKey: string) => {
  if (gamesPlaytime.has(gameKey)) return true;

  const pid = launchedGamePids.get(gameKey);

  return pid !== undefined && isProcessAlive(pid);
};

const serverManager = new UniverseLanServerManager({
  onError: (error) =>
    achievementsLogger.error("UniverseLAN server failed", error),
  isHolderRunning: isGameRunning,
});

const pendingPackages = new Map<string, Promise<string | null>>();

const isGogAchievementsEnabled = async () => {
  const preferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  return preferences?.enableGogAchievements ?? false;
};

const getLocalAppDataUniverseLanPath = () =>
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, UNIVERSE_LAN_DIR_NAME)
    : null;

const pathExists = (target: string) =>
  fs.promises
    .access(target)
    .then(() => true)
    .catch(() => false);

const isPackageReady = async (packageDirectory: string) => {
  const checks = await Promise.all(
    [PACKAGE_METADATA_FILE_NAME, ...REQUIRED_PACKAGE_FILES].map((file) =>
      pathExists(path.join(packageDirectory, file))
    )
  );

  return checks.every(Boolean);
};

const downloadPackage = async (sdkVersion: string) => {
  const { data: releases } = await axios.get<GitHubRelease[]>(
    UNIVERSE_LAN_RELEASES_URL,
    {
      timeout: RELEASES_TIMEOUT_IN_MS,
      headers: { Accept: "application/vnd.github+json" },
    }
  );

  const universeLanPackage = selectUniverseLanPackage(releases, sdkVersion);

  if (!universeLanPackage) {
    achievementsLogger.warn(
      `No UniverseLAN build available for Galaxy SDK ${sdkVersion}`
    );
    return null;
  }

  const { data } = await axios.get<ArrayBuffer>(
    universeLanPackage.downloadUrl,
    {
      responseType: "arraybuffer",
      timeout: DOWNLOAD_TIMEOUT_IN_MS,
      maxContentLength: MAX_PACKAGE_SIZE_IN_BYTES,
    }
  );

  const archive = Buffer.from(data);
  assertPackageIntegrity(universeLanPackage, archive);

  await fs.promises.mkdir(PACKAGE_CACHE_PATH, { recursive: true });

  const temporaryId = randomUUID();
  const archivePath = path.join(PACKAGE_CACHE_PATH, `${temporaryId}.zip`);
  const extractionPath = path.join(PACKAGE_CACHE_PATH, `${temporaryId}.tmp`);
  const packageDirectory = path.join(PACKAGE_CACHE_PATH, sdkVersion);

  try {
    await fs.promises.writeFile(archivePath, archive);
    await SevenZip.extractFile({
      filePath: archivePath,
      outputPath: extractionPath,
    });

    await fs.promises.writeFile(
      path.join(extractionPath, PACKAGE_METADATA_FILE_NAME),
      JSON.stringify(universeLanPackage, null, 2)
    );

    if (!(await isPackageReady(extractionPath))) {
      throw new Error(`Unexpected UniverseLAN package layout: ${sdkVersion}`);
    }

    await fs.promises.rm(packageDirectory, { recursive: true, force: true });
    await fs.promises.rename(extractionPath, packageDirectory);
  } finally {
    await Promise.all([
      fs.promises.rm(archivePath, { force: true }),
      fs.promises.rm(extractionPath, { recursive: true, force: true }),
    ]);
  }

  achievementsLogger.info(
    `Downloaded UniverseLAN build ${universeLanPackage.build} for Galaxy SDK ${sdkVersion}`
  );

  return packageDirectory;
};

/** Returns the extracted UniverseLAN package for this Galaxy SDK version. */
const ensurePackage = (sdkVersion: string) => {
  const packageDirectory = path.join(PACKAGE_CACHE_PATH, sdkVersion);
  const pending = pendingPackages.get(sdkVersion);

  if (pending !== undefined) return pending;

  const promise = isPackageReady(packageDirectory)
    .then((ready) => (ready ? packageDirectory : downloadPackage(sdkVersion)))
    .finally(() => pendingPackages.delete(sdkVersion));

  pendingPackages.set(sdkVersion, promise);

  return promise;
};

const readPackageBuild = async (packageDirectory: string) => {
  const metadata = JSON.parse(
    await fs.promises.readFile(
      path.join(packageDirectory, PACKAGE_METADATA_FILE_NAME),
      "utf-8"
    )
  );

  return String(metadata.build);
};

/**
 * The game DLL reads the authentication key from the shared
 * `%LOCALAPPDATA%/UniverseLAN/UniverseLAN.ini` and the server reads it from the
 * `UniverseLAN.ini` next to its executable: both must hold the same key.
 */
const writeBootAndServerConfig = async (
  packageDirectory: string,
  localAppDataUniverseLanPath: string
) => {
  const sharedBootFilePath = path.join(
    localAppDataUniverseLanPath,
    BOOT_FILE_NAME
  );
  const packageBootFilePath = path.join(packageDirectory, BOOT_FILE_NAME);
  const template = await fs.promises.readFile(packageBootFilePath, "utf-8");

  const existingSharedBootFile = await fs.promises
    .readFile(sharedBootFilePath, "utf-8")
    .catch(() => null);

  let authenticationKey = existingSharedBootFile
    ? readIniValue(existingSharedBootFile, AUTHENTICATION_KEY_NAME)
    : null;

  if (!authenticationKey) {
    authenticationKey = generateAuthenticationKey();

    await fs.promises.mkdir(localAppDataUniverseLanPath, { recursive: true });
    await fs.promises.writeFile(
      sharedBootFilePath,
      buildBootFile(existingSharedBootFile ?? template, authenticationKey)
    );
  }

  await fs.promises.writeFile(
    packageBootFilePath,
    buildBootFile(template, authenticationKey)
  );

  const serverConfigPath = path.join(
    packageDirectory,
    "UniverseLANServerData",
    CLIENT_CONFIG_FILE_NAME
  );

  await fs.promises.writeFile(
    serverConfigPath,
    buildServerConfig(await fs.promises.readFile(serverConfigPath, "utf-8"))
  );
};

/** Pre-creates the per game client config so UniverseLAN never opens a console. */
const writeMissingClientConfigs = async (
  packageDirectory: string,
  dataDirectories: string[]
) => {
  const template = await fs.promises.readFile(
    path.join(packageDirectory, "UniverseLANData", CLIENT_CONFIG_FILE_NAME),
    "utf-8"
  );

  await Promise.all(
    dataDirectories.map(async (dataDirectory) => {
      const configPath = path.join(dataDirectory, CLIENT_CONFIG_FILE_NAME);

      if (await pathExists(configPath)) return;

      await fs.promises.mkdir(dataDirectory, { recursive: true });
      await fs.promises.writeFile(configPath, buildClientConfig(template));
    })
  );
};

const installIfOriginal = async (dll: GalaxyDll): Promise<GalaxyDll> => {
  if (dll.kind !== "gog" || !dll.sdkVersion) return dll;

  const packageDirectory = await ensurePackage(dll.sdkVersion);
  if (!packageDirectory) return dll;

  await installUniverseLanDll({
    dll,
    replacementPath: path.join(
      packageDirectory,
      dll.architecture === "x64" ? "Galaxy64.dll" : "Galaxy.dll"
    ),
    sdkVersion: dll.sdkVersion,
    build: await readPackageBuild(packageDirectory),
  });

  achievementsLogger.info(`Installed UniverseLAN into ${dll.filePath}`);

  return { ...dll, kind: "universe-lan" };
};

const restoreHydraInstalledDlls = (dlls: GalaxyDll[]) =>
  Promise.all(
    dlls.map(async (dll) => {
      if (!(await readInstallMarker(dll.filePath))) return;

      const result = await restoreGalaxyDll(dll.filePath);
      achievementsLogger.info(`Restore of ${dll.filePath}: ${result}`);
    })
  );

const hasLegacyUniverseLanSetup = async (directories: string[]) => {
  const checks = await Promise.all(
    directories.map((directory) =>
      pathExists(path.join(directory, BOOT_FILE_NAME))
    )
  );

  return checks.some(Boolean);
};

const prepareUniverseLan = async (gameKey: string, executablePath: string) => {
  try {
    const localAppDataUniverseLanPath = getLocalAppDataUniverseLanPath();
    if (!localAppDataUniverseLanPath) return;

    const locations = await resolveGameDirectoryLocations(executablePath);
    const dlls = await findGalaxyDlls(locations.bases);

    if (!dlls.length) return;

    if (!(await isGogAchievementsEnabled())) {
      await restoreHydraInstalledDlls(dlls);
      return;
    }

    if (!locations.universeLanDataDirectories.length) {
      achievementsLogger.info(
        `Skipping UniverseLAN for ${gameKey}: no goggame-*.info file found`
      );
      return;
    }

    if (await hasLegacyUniverseLanSetup(locations.bases)) {
      achievementsLogger.info(
        `Skipping UniverseLAN for ${gameKey}: the game folder has its own UniverseLAN.ini`
      );
      return;
    }

    // Each DLL is a different file; ensurePackage de-duplicates downloads.
    const preparedDlls = await Promise.all(
      dlls.map((dll) =>
        installIfOriginal(dll).catch((error) => {
          achievementsLogger.error(
            `Failed to install UniverseLAN into ${dll.filePath}`,
            error
          );
          return dll;
        })
      )
    );

    const activeDll =
      preparedDlls.find(
        (dll) => dll.kind === "universe-lan" && dll.architecture === "x64"
      ) ?? preparedDlls.find((dll) => dll.kind === "universe-lan");

    if (!activeDll?.sdkVersion) return;

    const packageDirectory = await ensurePackage(activeDll.sdkVersion);
    if (!packageDirectory) return;

    await writeBootAndServerConfig(
      packageDirectory,
      localAppDataUniverseLanPath
    );
    await writeMissingClientConfigs(
      packageDirectory,
      locations.universeLanDataDirectories
    );

    const serverStarted = serverManager.acquire(
      gameKey,
      path.join(
        packageDirectory,
        activeDll.architecture === "x64"
          ? "UniverseLANServer64.exe"
          : "UniverseLANServer.exe"
      )
    );

    if (!serverStarted) {
      achievementsLogger.warn(
        `UniverseLAN server for Galaxy SDK ${activeDll.sdkVersion} not started for ${gameKey}: another running game uses a different UniverseLAN server`
      );
      return;
    }

    const installedBy = (await isHydraInstalled(activeDll.filePath))
      ? "Hydra"
      : "the user";

    achievementsLogger.info(
      `UniverseLAN ready for ${gameKey} (Galaxy SDK ${activeDll.sdkVersion}, installed by ${installedBy})`
    );
  } catch (error) {
    achievementsLogger.error(
      `Failed to prepare UniverseLAN for ${gameKey}`,
      error
    );
  }
};

let preparationQueue: Promise<void> = Promise.resolve();

/**
 * Called right before a game starts. For GOG games it swaps the original
 * Galaxy DLL for the matching UniverseLAN build (keeping a backup) and starts
 * the local UniverseLAN server, so achievements end up in a file Hydra reads.
 * Preparations run one at a time so overlapping launches never inspect or
 * back up a DLL another preparation is replacing. Never throws: a failure here
 * must not prevent the game from launching.
 */
export const prepareUniverseLanForLaunch = (
  gameKey: string,
  executablePath: string
) => {
  if (process.platform !== "win32") return Promise.resolve();

  const preparation = preparationQueue.then(() =>
    prepareUniverseLan(gameKey, executablePath)
  );

  preparationQueue = preparation.catch(() => {});

  return preparation;
};

export const releaseUniverseLanServer = (gameKey: string) =>
  serverManager.release(gameKey);

export const stopUniverseLanServer = () => serverManager.stopAll();
