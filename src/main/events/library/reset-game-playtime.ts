import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";

const resetGamePlaytime = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  try {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    if (game.remoteId) {
      await HydraApi.delete(`/profile/games/${shop}/${objectId}/playtime`);
    }

    await gamesSublevel.put(gameKey, {
      ...game,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      hasManuallyUpdatedPlaytime: false,
    });
  } catch (error) {
    throw new Error(`Failed to reset game playtime: ${error}`);
  }
};

registerEvent("resetGamePlayTime", resetGamePlaytime);
