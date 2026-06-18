import type { RetroachievementGameData } from "@main/services/achievements/retroachievements-fetcher";
import { db } from "../level";
import { levelKeys } from "./keys";

export interface RetroachievementsGameProgressCacheEntry {
  updatedAt: number;
  data: RetroachievementGameData;
}

export const retroachievementsGameProgressSublevel = db.sublevel<
  string,
  RetroachievementsGameProgressCacheEntry
>(levelKeys.retroachievementsGameProgress, {
  valueEncoding: "json",
});
