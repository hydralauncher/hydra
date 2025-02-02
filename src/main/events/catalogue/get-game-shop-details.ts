import { getSteamAppDetails, logger } from "@main/services";

import type { ShopDetails, GameShop } from "@types";

import { registerEvent } from "../register-event";
import { steamGamesWorker } from "@main/workers";
import { gamesShopCacheSublevel, levelKeys } from "@main/level";

const getLocalizedSteamAppDetails = async (
  objectId: string,
  language: string
): Promise<ShopDetails | null> => {
  if (language === "english") {
    return getSteamAppDetails(objectId, language);
  }

  return getSteamAppDetails(objectId, language).then(
    async (localizedAppDetails) => {
      const steamGame = await steamGamesWorker.run(Number(objectId), {
        name: "getById",
      });

      if (steamGame && localizedAppDetails) {
        return {
          ...localizedAppDetails,
          name: steamGame.name,
        };
      }

      return null;
    }
  );
};

const getGameShopDetails = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  language: string
): Promise<ShopDetails | null> => {
  if (shop === "steam") {
    const cachedData = await gamesShopCacheSublevel.get(
      levelKeys.gameShopCacheItem(shop, objectId, language)
    );

    const appDetails = getLocalizedSteamAppDetails(objectId, language).then(
      (result) => {
        if (result) {
          gamesShopCacheSublevel
            .put(levelKeys.gameShopCacheItem(shop, objectId, language), result)
            .catch((err) => {
              logger.error("Could not cache game details", err);
            });
        }

        return result;
      }
    );

    if (cachedData) {
      return {
        ...cachedData,
        objectId,
      } as ShopDetails;
    }

    return Promise.resolve(appDetails);
  }

  throw new Error("Not implemented");
};

registerEvent("getGameShopDetails", getGameShopDetails);
