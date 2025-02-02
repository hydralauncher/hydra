import type { ShopDetails } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const gamesShopCacheSublevel = db.sublevel<string, ShopDetails>(
  levelKeys.gameShopCache,
  {
    valueEncoding: "json",
  }
);
