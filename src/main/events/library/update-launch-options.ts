import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";
import { logger, updateSteamShortcutLaunchOptions } from "@main/services";

const updateLaunchOptions = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  launchOptions: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);

  if (game) {
    const normalizedLaunchOptions =
      launchOptions?.trim() || null;

    await gamesSublevel.put(gameKey, {
      ...game,
      launchOptions: normalizedLaunchOptions,
    });

    if (game.steamShortcutAppId) {
      await updateSteamShortcutLaunchOptions(
        game.steamShortcutAppId,
        normalizedLaunchOptions
      ).catch((err) => {
        logger.error("Failed to update Steam shortcut launch options", err);
      });
    }
  }
};

registerEvent("updateLaunchOptions", updateLaunchOptions);
