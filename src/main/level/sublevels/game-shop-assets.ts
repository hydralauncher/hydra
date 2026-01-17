import type { ShopAssets } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const gamesShopAssetsSublevel = db.sublevel<
  string,
  ShopAssets & { updatedAt: number }
>(levelKeys.gameShopAssets, {
  valueEncoding: "json",
});
