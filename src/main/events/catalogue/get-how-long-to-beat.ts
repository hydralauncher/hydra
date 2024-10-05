import type { GameShop, HowLongToBeatCategory } from "@types";
import { getHowLongToBeatGame, searchHowLongToBeat } from "@main/services";

import { registerEvent } from "../register-event";
import { gameShopCacheRepository } from "@main/repository";

const getHowLongToBeat = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  title: string
): Promise<HowLongToBeatCategory[] | null> => {
  const searchHowLongToBeatPromise = searchHowLongToBeat(title);

  const gameShopCache = await gameShopCacheRepository.findOne({
    where: { objectID: objectId, shop },
  });

  const howLongToBeatCachedData = gameShopCache?.howLongToBeatSerializedData
    ? JSON.parse(gameShopCache?.howLongToBeatSerializedData)
    : null;
  if (howLongToBeatCachedData) return howLongToBeatCachedData;

  return searchHowLongToBeatPromise.then(async (response) => {
    const game = response.data.find(
      (game) => game.profile_steam === Number(objectId)
    );

    if (!game) return null;
    const howLongToBeat = await getHowLongToBeatGame(String(game.game_id));

    gameShopCacheRepository.upsert(
      {
        objectID: objectId,
        shop,
        howLongToBeatSerializedData: JSON.stringify(howLongToBeat),
      },
      ["objectID"]
    );

    return howLongToBeat;
  });
};

registerEvent("getHowLongToBeat", getHowLongToBeat);
