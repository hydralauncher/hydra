import type { GameShop, ShopAssets } from "@types";
import { gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";

const saveGameShopAssets = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  assets: ShopAssets
): Promise<void> => {
  return gamesShopAssetsSublevel.put(levelKeys.game(shop, objectId), assets);
};

registerEvent("saveGameShopAssets", saveGameShopAssets);
