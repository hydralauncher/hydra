import path from "node:path";

import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import {
  GameExecutables,
  GameFilesManager,
  logger,
  NativeAddon,
  type NativeProcessPayload,
  Wine,
  WindowManager,
} from "@main/services";
import type { Download } from "@types";
import {
  endInstallerRun,
  markInstallerRunLive,
} from "./installed-executable-poller";

const RECOVERY_POLL_INTERVAL_MS = 15_000;
const RECOVERY_MAX_DURATION_MS = 6 * 60 * 60_000;
const LINUX_PROCESS_NAME_LIMIT = 15;
const FIRST_CHECK_DELAY_MS = 10_000;
const WINE_UNIX_DRIVE_PATTERN = /^z:\\/i;

const isSamePath = (first: string, second: string) =>
  process.platform === "win32"
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;

export const isInstallerProcess = (
  process: Pick<NativeProcessPayload, "exe" | "name" | "peExecutablePath">,
  installerPath: string
) => {
  const installerName = path.win32.basename(installerPath).toLowerCase();

  if (process.exe && isSamePath(process.exe, installerPath)) return true;

  const peExecutable = process.peExecutablePath;
  if (peExecutable) {
    const unixPath = WINE_UNIX_DRIVE_PATTERN.test(peExecutable)
      ? peExecutable.slice(2).replaceAll("\\", "/")
      : null;

    return unixPath
      ? unixPath === installerPath
      : path.win32.basename(peExecutable).toLowerCase() === installerName;
  }

  const runsThroughWine = !process.exe?.toLowerCase().endsWith(".exe");
  const processName = process.name.toLowerCase();
  const nameMatches =
    processName === installerName ||
    (processName.length >= LINUX_PROCESS_NAME_LIMIT &&
      installerName.startsWith(processName));

  return runsThroughWine && nameMatches;
};

const isInstallerProcessAlive = async (installerPath: string) => {
  const processes = await NativeAddon.listProcesses();
  return processes.some((process) =>
    isInstallerProcess(process, installerPath)
  );
};

const updateDownload = async (
  gameKey: string,
  state: Partial<Pick<Download, "installerLaunched" | "installerRunning">>
) => {
  const download = await downloadsSublevel.get(gameKey);
  if (!download) return;

  await downloadsSublevel.put(gameKey, { ...download, ...state });
  WindowManager.sendDownloadsUpdated();
};

const settleInterruptedInstall = async (download: Download) => {
  const { shop, objectId } = download;
  const gameKey = levelKeys.game(shop, objectId);
  const installerStartedAt = download.installerStartedAt ?? 0;
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  const catalogueLoaded = await GameExecutables.ensureLoaded().catch(
    () => false
  );
  const canDetectInstall =
    catalogueLoaded &&
    (GameExecutables.getExecutablesForGame(objectId)?.length ?? 0) > 0;

  const executableFound = await new GameFilesManager(
    shop,
    objectId
  ).searchAndBindInstalledExecutable(
    installerStartedAt,
    Wine.getEffectivePrefixPath(game?.winePrefixPath, objectId)
  );

  const keepInstallerLaunched = executableFound || !canDetectInstall;

  if (executableFound) {
    logger.info(
      `[GameInstaller] Found the executable for ${objectId} after an interrupted install`
    );
  } else if (canDetectInstall) {
    logger.info(
      `[GameInstaller] Interrupted install for ${objectId} left no executable, back to Install`
    );
  } else {
    logger.info(
      `[GameInstaller] Cannot detect the install for ${objectId}, leaving it on Select executable`
    );
  }

  await updateDownload(gameKey, {
    installerRunning: false,
    installerLaunched: keepInstallerLaunched,
  });

  WindowManager.sendToAppWindows("on-library-batch-complete");
  if (executableFound) {
    WindowManager.sendToAppWindows(
      "on-game-installer-closed",
      shop,
      objectId,
      true
    );
  }
};

const watchInterruptedInstall = (download: Download) => {
  const gameKey = levelKeys.game(download.shop, download.objectId);
  const installerStartedAt = download.installerStartedAt ?? 0;
  const installerPath = download.installerPath;
  const deadline = Date.now() + RECOVERY_MAX_DURATION_MS;
  let checking = false;

  markInstallerRunLive(gameKey, installerStartedAt);

  const finish = async () => {
    clearInterval(timer);
    endInstallerRun(gameKey, installerStartedAt);
    await settleInterruptedInstall(download);
  };

  const check = async () => {
    if (checking) return;
    checking = true;

    try {
      const stillRunning =
        !!installerPath &&
        Date.now() < deadline &&
        (await isInstallerProcessAlive(installerPath));

      if (!stillRunning) await finish();
    } catch (error) {
      logger.error(
        `[GameInstaller] Failed to recover the install for ${download.objectId}`,
        error
      );
    } finally {
      checking = false;
    }
  };

  const timer = setInterval(() => void check(), RECOVERY_POLL_INTERVAL_MS);
  timer.unref();
  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS).unref();
};

export const recoverInterruptedInstallers = async () => {
  const entries = await downloadsSublevel.iterator().all();
  const interrupted = entries
    .map(([, download]) => download)
    .filter((download) => download.installerRunning);

  if (interrupted.length === 0) return;

  for (const download of interrupted) {
    logger.info(
      `[GameInstaller] Hydra stopped while the installer for ${download.objectId} was running, checking how it ended`
    );
    watchInterruptedInstall(download);
  }
};
