import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "@main/services";
import type { GameShop, UserGameDetails } from "@types";

const syncGameByObjectId = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  return HydraApi.get<UserGameDetails>(
    `/profile/games/${shop}/${objectId}`
  ).then(async (res) => {
    const { id, playTimeInSeconds, ...rest } = res;

    const gameKey = levelKeys.game(shop, objectId);

    await gamesSublevel.put(gameKey, {
      ...rest,
      remoteId: id,
      playTimeInMilliseconds: playTimeInSeconds * 1000,
    });

    return res;
  });
};

registerEvent("syncGameByObjectId", syncGameByObjectId);
