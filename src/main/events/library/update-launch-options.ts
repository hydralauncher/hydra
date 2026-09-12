import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { updateGameInstallation } from "@main/services/game-installations";
import { GameShop } from "@types";

const updateLaunchOptions = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  launchOptions: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);

  if (game) {
    await updateGameInstallation(game, {
      launchOptions: launchOptions?.trim() != "" ? launchOptions : null,
    });
  }
};

registerEvent("updateLaunchOptions", updateLaunchOptions);
