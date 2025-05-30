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
    const { id, playTimeInSeconds, isFavorite, ...rest } = res;

    const gameKey = levelKeys.game(shop, objectId);

    const currentData = await gamesSublevel.get(gameKey);

    await gamesSublevel.put(gameKey, {
      ...rest,
      remoteId: id,
      playTimeInMilliseconds: playTimeInSeconds * 1000,
      favorite: isFavorite ?? currentData?.favorite,
    });

    return res;
  });
};

registerEvent("syncGameByObjectId", syncGameByObjectId);
