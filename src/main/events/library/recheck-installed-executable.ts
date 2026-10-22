import { registerEvent } from "../register-event";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { GameFilesManager, logger, Wine, WindowManager } from "@main/services";
import type { GameShop } from "@types";

const RECHECK_INTERVAL_MS = 30_000;

const lastRecheckAt = new Map<string, number>();

const recheckInstalledExecutable = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  const gameKey = levelKeys.game(shop, objectId);
  const [download, game] = await Promise.all([
    downloadsSublevel.get(gameKey),
    gamesSublevel.get(gameKey).catch(() => null),
  ]);

  if (
    !download?.installerLaunched ||
    download.installerRunning ||
    !download.installerStartedAt ||
    game?.executablePath
  ) {
    return false;
  }

  const now = Date.now();
  if (now - (lastRecheckAt.get(gameKey) ?? 0) < RECHECK_INTERVAL_MS) {
    return false;
  }
  lastRecheckAt.set(gameKey, now);

  const executableFound = await new GameFilesManager(
    shop,
    objectId
  ).searchAndBindInstalledExecutable(
    download.installerStartedAt,
    Wine.getEffectivePrefixPath(game?.winePrefixPath, objectId)
  );

  if (executableFound) {
    logger.info(
      `[GameInstaller] Found the installed executable for ${objectId} on a later check`
    );
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  return executableFound;
};

registerEvent("recheckInstalledExecutable", recheckInstalledExecutable);
