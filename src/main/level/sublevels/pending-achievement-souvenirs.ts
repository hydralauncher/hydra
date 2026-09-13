import { db } from "../level";
import { levelKeys } from "./keys";

export const pendingAchievementSouvenirsSublevel = db.sublevel<
  string,
  Record<string, string>
>(levelKeys.pendingAchievementSouvenirs, { valueEncoding: "json" });
