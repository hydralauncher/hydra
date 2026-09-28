import fs from "node:fs";
import path from "node:path";
import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamLibraryFolders, getSteamLocation } from "../steam";
import { steamSyncLogger } from "../logger";
import { WindowManager } from "../window-manager";
import { refreshSteamGameExecutable } from "./link-imported-steam-executables";
import { steamAppIdFromManifestFileName } from "./steam-installation-core";
import { getInstalledSteamApps } from "./steam-launch-executables";

const MANIFEST_CHECK_DELAY_MS = 3000;
const MANIFEST_RECHECK_DELAY_MS = 30000;

const checkTimers = new Map<string, NodeJS.Timeout>();
const recheckTimers = new Map<string, NodeJS.Timeout>();
const directoryWatchers = new Map<string, fs.FSWatcher>();
const LIBRARY_FOLDERS_FILE_NAME = "libraryfolders.vdf";
let libraryRewatchTimer: NodeJS.Timeout | undefined;
const reconcileTimers: NodeJS.Timeout[] = [];

const isImportedSteamGame = async (steamAppId: string) => {
  const game = await gamesSublevel.get(levelKeys.game("steam", steamAppId));
  return game?.hasActiveSteamImport === true && game.isDeleted !== true;
};

const refreshInstalledState = async (steamAppId: string) => {
  if (!(await isImportedSteamGame(steamAppId))) return;
  if (!(await refreshSteamGameExecutable(steamAppId))) return;

  steamSyncLogger.log(`Steam install state changed for ${steamAppId}`);
  WindowManager.sendToAppWindows("on-library-batch-complete");
};

const scheduleRefresh = (
  timers: Map<string, NodeJS.Timeout>,
  steamAppId: string,
  delayMs: number
) => {
  clearTimeout(timers.get(steamAppId));
  timers.set(
    steamAppId,
    setTimeout(() => {
      timers.delete(steamAppId);
      void refreshInstalledState(steamAppId);
    }, delayMs)
  );
};

const reconcileImportedSteamGames = async () => {
  const installedAppIds = new Set(
    (await getInstalledSteamApps()).map((app) => app.appId)
  );
  const importedGames = (await gamesSublevel.values().all()).filter(
    (game) =>
      game.shop === "steam" &&
      game.hasActiveSteamImport === true &&
      game.isDeleted !== true
  );

  for (const game of importedGames) {
    if (!game.executablePath && !installedAppIds.has(game.objectId)) continue;

    await refreshInstalledState(game.objectId);
  }
};

const scheduleReconcile = () => {
  reconcileTimers.splice(0).forEach(clearTimeout);

  for (const delayMs of [MANIFEST_CHECK_DELAY_MS, MANIFEST_RECHECK_DELAY_MS]) {
    reconcileTimers.push(
      setTimeout(() => {
        reconcileImportedSteamGames().catch((error) =>
          steamSyncLogger.error("Failed to reconcile Steam libraries", error)
        );
      }, delayMs)
    );
  }
};

const scheduleLibraryRewatch = () => {
  clearTimeout(libraryRewatchTimer);
  libraryRewatchTimer = setTimeout(
    () => void watchSteamLibraries(),
    MANIFEST_CHECK_DELAY_MS
  );
};

const handleSteamAppsChange = (fileName: string | Buffer | null) => {
  if (!fileName) {
    scheduleLibraryRewatch();
    scheduleReconcile();
    return;
  }

  if (fileName.toString() === LIBRARY_FOLDERS_FILE_NAME) {
    scheduleLibraryRewatch();
    return;
  }

  const steamAppId = steamAppIdFromManifestFileName(fileName.toString());
  if (!steamAppId) return;

  scheduleRefresh(checkTimers, steamAppId, MANIFEST_CHECK_DELAY_MS);
  scheduleRefresh(recheckTimers, steamAppId, MANIFEST_RECHECK_DELAY_MS);
};

export const watchSteamLibraries = async () => {
  const libraryFolders = await getSteamLibraryFolders().catch(() => []);
  const steamLocation = await getSteamLocation().catch(() => null);
  const watchedDirectories = [
    ...libraryFolders.map((libraryFolder) =>
      path.join(libraryFolder, "steamapps")
    ),
    ...(steamLocation ? [path.join(steamLocation, "config")] : []),
  ];

  for (const watchedDirectory of watchedDirectories) {
    if (directoryWatchers.has(watchedDirectory)) continue;

    try {
      const watcher = fs.watch(watchedDirectory, (_eventType, fileName) =>
        handleSteamAppsChange(fileName)
      );
      watcher.on("error", (error) => {
        steamSyncLogger.error(
          `Stopped watching Steam library ${watchedDirectory}`,
          error
        );
        watcher.close();
        directoryWatchers.delete(watchedDirectory);
      });
      directoryWatchers.set(watchedDirectory, watcher);
    } catch (error) {
      steamSyncLogger.error(
        `Failed to watch Steam library ${watchedDirectory}`,
        error
      );
    }
  }
};

export const watchSteamAppInstall = async (steamAppId: string) => {
  await watchSteamLibraries();
  scheduleRefresh(checkTimers, steamAppId, MANIFEST_CHECK_DELAY_MS);
};
