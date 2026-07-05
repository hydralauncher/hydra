import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";
import { updateSteamShortcutLaunchOptions } from "@main/services";

const updateLaunchOptions = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  launchOptions: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...game,
      launchOptions: launchOptions?.trim() != "" ? launchOptions : null,
    });

    if (game.steamShortcutAppId) {
      await updateSteamShortcutLaunchOptions(
        game.steamShortcutAppId,
        launchOptions
      ).catch(() => {});
    }
  }
};

registerEvent("updateLaunchOptions", updateLaunchOptions);
