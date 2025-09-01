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
  return gamesShopAssetsSublevel.put(key, { ...existingAssets, ...assets });
};

registerEvent("saveGameShopAssets", saveGameShopAssets);
