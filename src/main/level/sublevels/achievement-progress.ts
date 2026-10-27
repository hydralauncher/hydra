import type { AchievementProgress } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const achievementProgressSublevel = db.sublevel<
  string,
  AchievementProgress
>(levelKeys.achievementProgress, {
  valueEncoding: "json",
});
