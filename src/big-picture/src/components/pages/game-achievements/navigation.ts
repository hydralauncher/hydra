export const GAME_ACHIEVEMENTS_PAGE_REGION_ID = "game-achievements-page";
export const GAME_ACHIEVEMENTS_LIST_REGION_ID = "game-achievements-list";
export const GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID = "game-achievements-summary";

export const getAchievementRowId = (achievementName: string) =>
  `achievement-row-${achievementName}`;
