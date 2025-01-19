import { registerEvent } from "../register-event";
import { levelKeys } from "@main/level";
import { gamesSublevel } from "@main/level";
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
    await gamesSublevel.put(gameKey, {
      ...game,
      launchOptions: launchOptions?.trim() != "" ? launchOptions : null,
    });
  }
};

registerEvent("updateLaunchOptions", updateLaunchOptions);
