import type { GameShop, ShopAssets } from "@types";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { gamesShopAssetsSublevel, levelKeys } from "@main/level";

const LOCAL_CACHE_EXPIRATION = 1000 * 60 * 60 * 8; // 8 hours

export const getGameAssets = async (objectId: string, shop: GameShop) => {
  const cachedAssets = await gamesShopAssetsSublevel.get(
    levelKeys.game(shop, objectId)
  );

  if (
    cachedAssets &&
    cachedAssets.updatedAt + LOCAL_CACHE_EXPIRATION > Date.now()
  ) {
    return cachedAssets;
  }

  return HydraApi.get<ShopAssets | null>(
    `/games/${shop}/${objectId}/assets`,
    null,
    {
      needsAuth: false,
    }
  ).then(async (assets) => {
    if (!assets) return null;

    // Preserve existing title if it differs from the incoming title (indicating it was customized)
    const shouldPreserveTitle =
      cachedAssets?.title && cachedAssets.title !== assets.title;

    await gamesShopAssetsSublevel.put(levelKeys.game(shop, objectId), {
      ...assets,
      title: shouldPreserveTitle ? cachedAssets.title : assets.title,
      updatedAt: Date.now(),
    });

    return assets;
  });
};

const getGameAssetsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  return getGameAssets(objectId, shop);
};

registerEvent("getGameAssets", getGameAssetsEvent);
