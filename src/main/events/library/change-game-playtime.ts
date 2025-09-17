import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { gamesSublevel } from "@main/level";
import { levelKeys } from "@main/level";

const changeGamePlaytime = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  playTimeInSeconds: number
) => {
  try {
    await HydraApi.put(`/profile/games/${shop}/${objectId}/playtime`, {
      playTimeInSeconds,
    });
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey);
    if (!game) return;
    await gamesSublevel.put(gameKey, {
      ...game,
      playTimeInMilliseconds: playTimeInSeconds * 1000,
      hasManuallyUpdatedPlaytime: true,
    });
  } catch (error) {
    throw new Error(`Failed to update game favorite status: ${error}`);
  }
};

registerEvent("changeGamePlayTime", changeGamePlaytime);
