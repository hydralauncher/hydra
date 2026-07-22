import { db } from "./level";

const LEGACY_GAME_ACHIEVEMENTS_SUBLEVEL = "gameAchievements";

export const clearLegacyAchievementPersistence = async () => {
  const legacyGameAchievements = db.sublevel<string, unknown>(
    LEGACY_GAME_ACHIEVEMENTS_SUBLEVEL,
    { valueEncoding: "json" }
  );

  await legacyGameAchievements.clear();
};
