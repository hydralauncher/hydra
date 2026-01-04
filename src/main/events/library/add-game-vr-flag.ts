import { registerEvent } from "../register-event";
import type { GameShop, Game } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";

const addGameVRFlag = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  enable: boolean
) => {
  try {
    const gameKey = levelKeys.game(shop, objectId);
    const game: Game | undefined = await gamesSublevel.get(gameKey);
    if (!game) return;

    await gamesSublevel.put(gameKey, {
      ...game,
      launchInVR: enable,
    });
  } catch (error) {
    throw new Error(
      `Failed to ${enable ? "enable" : "disable"} VR flag for game: ${error}`
    );
  }
};

registerEvent("addGameVRFlag", addGameVRFlag);
