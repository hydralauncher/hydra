import { access } from "node:fs/promises";
import {
  getCloudSaveEmulatorProvider,
  hasRpcs3CloudSaveDisc,
  isCloudSaveV2Eligible,
} from "@shared";

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

export const assertCloudSaveV2Eligible = async (
  objectId: string,
  shop: Parameters<typeof assertCloudSaveExecutableExists>[1]
) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (!game || !isCloudSaveV2Eligible(shop, game.platform)) {
    throw new Error("cloud_save_v2_not_available");
  }
  return game;
};

export const assertCloudSaveRuntimeAvailable = async (
  objectId: string,
  shop: Parameters<typeof assertCloudSaveExecutableExists>[1]
) => {
  const game = await assertCloudSaveV2Eligible(objectId, shop);
  if (
    getCloudSaveEmulatorProvider(shop, game.platform) === "rpcs3" &&
    !hasRpcs3CloudSaveDisc(game)
  ) {
    throw new Error("cloud_save_rpcs3_disc_missing");
  }
  if (getCloudSaveEmulatorProvider(shop, game.platform) === "retroarch") {
    const { getSelectedRetroArchRom } = await import(
      "./retroarch-save-provider"
    );
    if (!(await getSelectedRetroArchRom(game))) {
      throw new Error("cloud_save_retroarch_rom_missing");
    }
  }
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
  if (getCloudSaveEmulatorProvider(shop, game.platform) === "rpcs3") {
    const { assertRpcs3DiscIdentity } = await import("./rpcs3-game-identity");
    await assertRpcs3DiscIdentity(game);
  }
  return game;
};
