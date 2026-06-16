import { db } from "../level";
import { levelKeys } from "./keys";

export interface RetroachievementsGameListCacheEntry {
  updatedAt: number;
  games: RetroachievementsGameListItem[];
}

export interface RetroachievementsGameListItem {
  ID: number;
  Title: string;
  ConsoleID: number;
  ConsoleName: string;
  ImageIcon?: string | null;
  NumAchievements: number;
  NumLeaderboards?: number;
  Points: number;
  DateModified?: string | null;
  ForumTopicID?: number | null;
  Hashes?: string[];
}

export const retroachievementsGameListsSublevel = db.sublevel<
  string,
  RetroachievementsGameListCacheEntry
>(levelKeys.retroachievementsGameLists, {
  valueEncoding: "json",
});
