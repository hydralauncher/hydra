import { gameShopCacheRepository } from "@main/repository";
import { getSteamAppDetails } from "@main/services";

import type { ShopDetails, GameShop, SteamAppDetails } from "@types";

import { registerEvent } from "../register-event";
import { searchRepacks } from "../helpers/search-games";

const getGameShopDetails = async (
  _event: Electron.IpcMainInvokeEvent,
  objectID: string,
  shop: GameShop,
  language: string
): Promise<ShopDetails | null> => {
  if (shop === "steam") {
    const cachedData = await gameShopCacheRepository.findOne({
      where: { objectID, language },
    });

    const result = Promise.all([
      getSteamAppDetails(objectID, "english"),
      getSteamAppDetails(objectID, language),
    ]).then(([appDetails, localizedAppDetails]) => {
      if (appDetails && localizedAppDetails) {
        gameShopCacheRepository.upsert(
          {
            objectID,
            shop: "steam",
            language,
            serializedData: JSON.stringify({
              ...localizedAppDetails,
              name: appDetails.name,
            }),
          },
          ["objectID"]
        );
      }

      return [appDetails, localizedAppDetails];
    });

    const cachedGame = cachedData?.serializedData
      ? (JSON.parse(cachedData?.serializedData) as SteamAppDetails)
      : null;

    if (cachedGame) {
      return {
        ...cachedGame,
        repacks: searchRepacks(cachedGame.name),
        objectID,
      } as ShopDetails;
    }

    return result.then(([appDetails, localizedAppDetails]) => {
      if (!appDetails || !localizedAppDetails) return null;

      return {
        ...localizedAppDetails,
        name: appDetails.name,
        repacks: searchRepacks(appDetails.name),
        objectID,
      } as ShopDetails;
    });
  }

  throw new Error("Not implemented");
};

registerEvent(getGameShopDetails, {
  name: "getGameShopDetails",
  memoize: true,
});
