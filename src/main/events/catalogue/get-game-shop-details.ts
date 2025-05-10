import { getSteamAppDetails, logger } from "@main/services";

import type { ShopDetails, GameShop, ShopDetailsWithAssets } from "@types";

import { registerEvent } from "../register-event";
import {
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  levelKeys,
} from "@main/level";

const getLocalizedSteamAppDetails = async (
  objectId: string,
  language: string
): Promise<ShopDetails | null> => {
  if (language === "english") {
    return getSteamAppDetails(objectId, language);
  }

  return getSteamAppDetails(objectId, language);
};

const getGameShopDetails = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  language: string
): Promise<ShopDetailsWithAssets | null> => {
  if (shop === "steam") {
    const [cachedData, cachedAssets] = await Promise.all([
      gamesShopCacheSublevel.get(
        levelKeys.gameShopCacheItem(shop, objectId, language)
      ),
      gamesShopAssetsSublevel.get(levelKeys.game(shop, objectId)),
    ]);

    const appDetails = getLocalizedSteamAppDetails(objectId, language).then(
      (result) => {
        if (result) {
          result.name = cachedAssets?.title ?? result.name;

          gamesShopCacheSublevel
            .put(levelKeys.gameShopCacheItem(shop, objectId, language), result)
            .catch((err) => {
              logger.error("Could not cache game details", err);
            });

          return {
            ...result,
            assets: cachedAssets ?? null,
          };
        }

        return null;
      }
    );

    if (cachedData) {
      return {
        ...cachedData,
        assets: cachedAssets ?? null,
      };
    }

    return appDetails;
  }

  throw new Error("Not implemented");
};

registerEvent("getGameShopDetails", getGameShopDetails);
