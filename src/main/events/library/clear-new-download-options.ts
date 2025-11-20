import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import type { GameShop } from "@types";

const clearNewDownloadOptions = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);
  if (!game) return;

  try {
    await gamesSublevel.put(gameKey, {
      ...game,
      newDownloadOptionsCount: undefined,
    });
    logger.info(`Cleared newDownloadOptionsCount for game ${gameKey}`);
  } catch (error) {
    logger.error(`Failed to clear newDownloadOptionsCount: ${error}`);
  }
};

registerEvent("clearNewDownloadOptions", clearNewDownloadOptions);
