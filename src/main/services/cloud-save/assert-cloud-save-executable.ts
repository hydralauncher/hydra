import { access } from "node:fs/promises";
import { getCloudSaveEmulatorProvider } from "@shared";

import { gamesSublevel, levelKeys } from "@main/level";

import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { createCloudSaveExecutableGuard } from "./executable-path-guard";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { CLOUD_SAVE_EXECUTABLE_MISSING_ERROR } from "./executable-path-guard";

export const assertCloudSaveExecutableExists = createCloudSaveExecutableGuard({
  getGame: (objectId, shop) =>
    gamesSublevel.get(levelKeys.game(shop, objectId)),
  saveGame: (game) =>
    gamesSublevel.put(levelKeys.game(game.shop, game.objectId), game),
  pathExists: (executablePath) =>
    access(executablePath).then(
      () => true,
      () => false
    ),
  onExecutablePathCleared: (game, executablePath) => {
    logger.warn(
      "[Cloud Save] Sync cancelled because executable no longer exists",
      {
        shop: game.shop,
        objectId: game.objectId,
        executablePath,
      }
    );
    WindowManager.sendToAppWindows("on-library-batch-complete");
  },
});

export const assertCloudSaveRuntimeAvailable = async (
  objectId: string,
  shop: Parameters<typeof assertCloudSaveExecutableExists>[1]
) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (!getCloudSaveEmulatorProvider(shop, game?.platform)) {
    return assertCloudSaveExecutableExists(objectId, shop);
  }
  const context = await getCloudSaveGameContext(objectId, shop);
  if (!context.pathContext.executablePath) {
    throw new Error(CLOUD_SAVE_EXECUTABLE_MISSING_ERROR);
  }
  await access(context.pathContext.executablePath).catch(() => {
    throw new Error(CLOUD_SAVE_EXECUTABLE_MISSING_ERROR);
  });
  return game;
};
