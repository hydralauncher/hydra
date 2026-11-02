export const GAME_ACHIEVEMENTS_PAGE_REGION_ID = "game-achievements-page";
export const GAME_ACHIEVEMENTS_LIST_REGION_ID = "game-achievements-list";
export const GAME_ACHIEVEMENTS_TOOLBAR_REGION_ID = "game-achievements-toolbar";
export const GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID = "game-achievements-summary";
export const GAME_ACHIEVEMENTS_SEARCH_INPUT_ID = "game-achievements-search";
export const GAME_ACHIEVEMENTS_SORT_SELECT_ID = "game-achievements-sort";
export const GAME_ACHIEVEMENTS_STATUS_SELECT_ID = "game-achievements-status";

export const getAchievementRowId = (achievementName: string) =>
  `achievement-row-${achievementName}`;

export const getAchievementSetId = (setKey: string) =>
  `achievement-set-${setKey}`;
