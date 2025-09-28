import type { GameShop, ShopAssets } from "@types";
import { gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";

const saveGameShopAssets = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  assets: ShopAssets
): Promise<void> => {
  const key = levelKeys.game(shop, objectId);
  const existingAssets = await gamesShopAssetsSublevel.get(key);

  // Preserve existing title if it differs from the incoming title (indicating it was customized)
  const shouldPreserveTitle =
    existingAssets?.title && existingAssets.title !== assets.title;

  return gamesShopAssetsSublevel.put(key, {
    ...existingAssets,
    ...assets,
    title: shouldPreserveTitle ? existingAssets.title : assets.title,
  });
};

registerEvent("saveGameShopAssets", saveGameShopAssets);
