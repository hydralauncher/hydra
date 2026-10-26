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
    return path.win32.basename(peExecutable).toLowerCase() === installerName;
  }

  const runsThroughWine =
    !process.exe || !process.exe.toLowerCase().endsWith(".exe");
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

  const executableFound = await new GameFilesManager(
    shop,
    objectId
  ).searchAndBindInstalledExecutable(
    installerStartedAt,
    Wine.getEffectivePrefixPath(game?.winePrefixPath, objectId)
  );

  logger.info(
    executableFound
      ? `[GameInstaller] Found the executable for ${objectId} after an interrupted install`
      : `[GameInstaller] Interrupted install for ${objectId} left no executable, back to Install`
  );

  await updateDownload(gameKey, {
    installerRunning: false,
    installerLaunched: executableFound,
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

  return check();
};

export const recoverInterruptedInstallers = async () => {
  const entries = await downloadsSublevel.iterator().all();
  const interrupted = entries
    .map(([, download]) => download)
    .filter((download) => download.installerRunning);

  if (interrupted.length === 0) return;

  await GameExecutables.ensureLoaded().catch(() => false);

  await Promise.all(
    interrupted.map((download) => {
      logger.info(
        `[GameInstaller] Hydra stopped while the installer for ${download.objectId} was running, checking how it ended`
      );
      return watchInterruptedInstall(download);
    })
  );
};
