import { access } from "node:fs/promises";

import { gamesSublevel, levelKeys } from "@main/level";

import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { createCloudSaveExecutableGuard } from "./executable-path-guard";

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
