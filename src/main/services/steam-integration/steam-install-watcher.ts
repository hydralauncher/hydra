import fs from "node:fs";
import path from "node:path";
import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamLibraryFolders } from "../steam";
import { steamSyncLogger } from "../logger";
import { WindowManager } from "../window-manager";
import { refreshSteamGameExecutable } from "./link-imported-steam-executables";
import { steamAppIdFromManifestFileName } from "./steam-installation-core";

const MANIFEST_CHECK_DELAY_MS = 3000;
const MANIFEST_RECHECK_DELAY_MS = 30000;

const checkTimers = new Map<string, NodeJS.Timeout>();
const recheckTimers = new Map<string, NodeJS.Timeout>();
const directoryWatchers = new Map<string, fs.FSWatcher>();

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

const handleSteamAppsChange = (fileName: string | Buffer | null) => {
  const steamAppId = fileName
    ? steamAppIdFromManifestFileName(fileName.toString())
    : null;
  if (!steamAppId) return;

  scheduleRefresh(checkTimers, steamAppId, MANIFEST_CHECK_DELAY_MS);
  scheduleRefresh(recheckTimers, steamAppId, MANIFEST_RECHECK_DELAY_MS);
};

export const watchSteamLibraries = async () => {
  const libraryFolders = await getSteamLibraryFolders().catch(() => []);

  for (const libraryFolder of libraryFolders) {
    const steamAppsDirectory = path.join(libraryFolder, "steamapps");
    if (directoryWatchers.has(steamAppsDirectory)) continue;

    try {
      const watcher = fs.watch(steamAppsDirectory, (_eventType, fileName) =>
        handleSteamAppsChange(fileName)
      );
      watcher.on("error", (error) => {
        steamSyncLogger.error(
          `Stopped watching Steam library ${steamAppsDirectory}`,
          error
        );
        watcher.close();
        directoryWatchers.delete(steamAppsDirectory);
      });
      directoryWatchers.set(steamAppsDirectory, watcher);
    } catch (error) {
      steamSyncLogger.error(
        `Failed to watch Steam library ${steamAppsDirectory}`,
        error
      );
    }
  }
};

export const watchSteamAppInstall = async (steamAppId: string) => {
  await watchSteamLibraries();
  scheduleRefresh(checkTimers, steamAppId, MANIFEST_CHECK_DELAY_MS);
};
