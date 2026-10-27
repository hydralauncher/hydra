import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { GameFilesManager, logger, WindowManager } from "@main/services";
import type { GameShop } from "@types";

const POLL_INTERVAL_MS = 30_000;
const POLL_DURATION_MS = 10 * 60_000;

const pollers = new Map<string, NodeJS.Timeout>();
const liveInstallerRuns = new Map<string, number>();

export const markInstallerRunLive = (
  gameKey: string,
  installerStartedAt: number
) => {
  liveInstallerRuns.set(gameKey, installerStartedAt);
};

export const endInstallerRun = (
  gameKey: string,
  installerStartedAt: number
) => {
  if (liveInstallerRuns.get(gameKey) === installerStartedAt) {
    liveInstallerRuns.delete(gameKey);
  }
};

export const isInstallerRunLive = (gameKey: string) =>
  liveInstallerRuns.has(gameKey);

export const stopInstalledExecutablePolling = (gameKey: string) => {
  const timer = pollers.get(gameKey);
  if (timer) clearInterval(timer);
  pollers.delete(gameKey);
};

export const isPollingInstalledExecutable = (gameKey: string) =>
  pollers.has(gameKey);

const isStillWaitingForInstall = async (
  gameKey: string,
  installerStartedAt: number
) => {
  const [download, game] = await Promise.all([
    downloadsSublevel.get(gameKey),
    gamesSublevel.get(gameKey).catch(() => null),
  ]);

  return (
    !!download?.installerLaunched &&
    !download.installerRunning &&
    download.installerStartedAt === installerStartedAt &&
    !game?.executablePath
  );
};

export const startInstalledExecutablePolling = (
  shop: GameShop,
  objectId: string,
  installerStartedAt: number,
  winePrefixPath: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const deadline = Date.now() + POLL_DURATION_MS;
  let checking = false;

  stopInstalledExecutablePolling(gameKey);

  const poll = async () => {
    if (checking) return;
    if (Date.now() > deadline) {
      stopInstalledExecutablePolling(gameKey);
      return;
    }

    checking = true;

    try {
      if (!(await isStillWaitingForInstall(gameKey, installerStartedAt))) {
        stopInstalledExecutablePolling(gameKey);
        return;
      }

      const executableFound = await new GameFilesManager(
        shop,
        objectId
      ).searchAndBindInstalledExecutable(installerStartedAt, winePrefixPath);

      if (!executableFound) return;

      stopInstalledExecutablePolling(gameKey);
      logger.info(
        `[GameInstaller] Found the installed executable for ${objectId} while polling`
      );
      WindowManager.sendToAppWindows("on-library-batch-complete");
      WindowManager.sendToAppWindows(
        "on-game-installer-closed",
        shop,
        objectId,
        true
      );
    } catch (error) {
      logger.error(
        `[GameInstaller] Failed to poll for the installed executable of ${objectId}`,
        error
      );
    } finally {
      checking = false;
    }
  };

  pollers.set(
    gameKey,
    setInterval(() => void poll(), POLL_INTERVAL_MS)
  );
};
