import { access } from "node:fs/promises";

import { gamesSublevel, levelKeys } from "@main/level";
import {
  getEmulatorCloudSavePlatform,
  assertEmulatorCloudSaveAvailable,
} from "./emulator-cloud-save";

import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { createCloudSaveExecutableGuard } from "./executable-path-guard";

const assertGameExecutableExists = createCloudSaveExecutableGuard({
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

export const assertCloudSaveExecutableExists = async (
  objectId: string,
  shop: Parameters<typeof assertGameExecutableExists>[1]
) => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  const emulatorPlatform = getEmulatorCloudSavePlatform(game, shop);
  if (emulatorPlatform) {
    await assertEmulatorCloudSaveAvailable(emulatorPlatform);
    return game!;
  }
  return assertGameExecutableExists(objectId, shop);
};
