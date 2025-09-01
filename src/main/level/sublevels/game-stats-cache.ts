import type { GameStats } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const gamesStatsCacheSublevel = db.sublevel<
  string,
  GameStats & { updatedAt: number }
>(levelKeys.gameStatsCache, {
  valueEncoding: "json",
});
