import type { GameAssetsOptions, GameShop, ShopAssets } from "@types";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import {
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  levelKeys,
} from "@main/level";
import { composeAssetsWithArtwork } from "@shared";
import { resolveEpicDefaultArtwork } from "@main/services/game-artwork";

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
  options?: GameAssetsOptions
) => {
  if (shop === "custom") {
    return null;
  }

  const gameKey = levelKeys.game(shop, objectId);
  const artworkIdentity = options?.artworkIdentity ?? { shop, objectId };
  const artworkKey = levelKeys.game(
    artworkIdentity.shop,
    artworkIdentity.objectId
  );
  const cachedAssets = await gamesShopAssetsSublevel.get(gameKey);

  if (
    !options?.forceFresh &&
    cachedAssets &&
    cachedAssets.updatedAt + LOCAL_CACHE_EXPIRATION > Date.now()
  ) {
    if (shop !== "epic") return applyArtworkSelection(artworkKey, cachedAssets);
    const resolved = await resolveEpicDefaultArtwork(
      cachedAssets,
      cachedAssets
    );
    await gamesShopAssetsSublevel.put(gameKey, {
      ...resolved,
      updatedAt: cachedAssets.updatedAt,
    });
    return applyArtworkSelection(artworkKey, resolved);
  }

  return HydraApi.get<ShopAssets | null>(
    `/games/${shop}/${objectId}/assets`,
    null,
    {
      needsAuth: false,
    }
  ).then(async (assets) => {
    if (!assets) return null;
    if (shop === "epic")
      assets = await resolveEpicDefaultArtwork(
        assets,
        options?.forceFresh ? null : cachedAssets
      );

    const shouldPreserveTitle =
      !options?.forceFresh &&
      cachedAssets?.title &&
      cachedAssets.title !== assets.title;

    await gamesShopAssetsSublevel.put(gameKey, {
      ...assets,
      title: shouldPreserveTitle ? cachedAssets.title : assets.title,
      updatedAt: Date.now(),
    });

    return applyArtworkSelection(artworkKey, assets);
  });
};

const getGameAssetsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  options?: GameAssetsOptions
) => getGameAssets(objectId, shop, options);

registerEvent("getGameAssets", getGameAssetsEvent);
