import type { GameAchievement } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const gameAchievementsSublevel = db.sublevel<string, GameAchievement>(
  levelKeys.gameAchievements,
  {
    valueEncoding: "json",
  }
);
