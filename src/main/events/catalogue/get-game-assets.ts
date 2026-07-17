import type { GameShop, ShopAssets } from "@types";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import {
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  levelKeys,
} from "@main/level";
import { composeAssetsWithArtwork } from "@shared";

const LOCAL_CACHE_EXPIRATION = 1000 * 60 * 60 * 8; // 8 hours

const applyArtworkSelection = async <T extends ShopAssets | null>(
  gameKey: string,
  assets: T
): Promise<T> => {
  if (!assets) return assets;

  const selection = await gamesArtworkSelectionSublevel.get(gameKey);

  return composeAssetsWithArtwork(assets, selection);
};

export const getGameAssets = async (
  objectId: string,
  shop: GameShop,
  options?: { forceFresh?: boolean }
) => {
  if (shop === "custom") {
    return null;
  }

  const gameKey = levelKeys.game(shop, objectId);
  const cachedAssets = await gamesShopAssetsSublevel.get(gameKey);

  if (
    !options?.forceFresh &&
    cachedAssets &&
    cachedAssets.updatedAt + LOCAL_CACHE_EXPIRATION > Date.now()
  ) {
    return applyArtworkSelection(gameKey, cachedAssets);
  }

  return HydraApi.get<ShopAssets | null>(
    `/games/${shop}/${objectId}/assets`,
    null,
    {
      needsAuth: false,
    }
  ).then(async (assets) => {
    if (!assets) return null;

    const shouldPreserveTitle =
      !options?.forceFresh &&
      cachedAssets?.title &&
      cachedAssets.title !== assets.title;

    await gamesShopAssetsSublevel.put(gameKey, {
      ...assets,
      title: shouldPreserveTitle ? cachedAssets.title : assets.title,
      updatedAt: Date.now(),
    });

    return applyArtworkSelection(gameKey, assets);
  });
};

const getGameAssetsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  options?: { forceFresh?: boolean }
) => getGameAssets(objectId, shop, options);

registerEvent("getGameAssets", getGameAssetsEvent);
