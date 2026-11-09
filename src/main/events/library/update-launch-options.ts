import { updateGameRecord } from "@main/services/game-record-updater";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
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
    await updateGameRecord(gameKey, {
      launchOptions: launchOptions?.trim() != "" ? launchOptions : null,
    });
  }
};

registerEvent("updateLaunchOptions", updateLaunchOptions);
