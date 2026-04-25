import type { ShopAssets } from "@types";

export const HOME_HERO_ADD_TO_LIBRARY_ID = "home-hero-add-to-library";
export const HOME_HERO_OPEN_GAME_PAGE_ID = "home-hero-open-game-page";
export const HOME_HERO_DOWNLOAD_ID = "home-hero-download";
export const HOME_HERO_ACTIONS_REGION_ID = "home-hero-actions";
export const HOME_PAGE_REGION_ID = "home-page";
export const HOME_POPULAR_GAMES_ROW_REGION_ID = "home-popular-games-row";
export const HOME_WEEKLY_GAMES_ROW_REGION_ID = "home-weekly-games-row";
export const HOME_ACHIEVEMENTS_GAMES_ROW_REGION_ID =
  "home-achievements-games-row";

export function getPopularGameFocusId(
  game: Pick<ShopAssets, "shop" | "objectId">
) {
  return `home-popular-game-${game.shop}-${game.objectId}`;
}

export function getWeeklyGameFocusId(
  game: Pick<ShopAssets, "shop" | "objectId">
) {
  return `home-weekly-game-${game.shop}-${game.objectId}`;
}

export function getAchievementsGameFocusId(
  game: Pick<ShopAssets, "shop" | "objectId">
) {
  return `home-achievements-game-${game.shop}-${game.objectId}`;
}
