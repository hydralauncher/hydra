export const GAME_PAGE_REGION_ID = "game-page";
export const GAME_HERO_ACTIONS_REGION_ID = "game-hero-actions";
export const GAME_HERO_PRIMARY_ACTION_ID = "game-hero-primary-action";
export const GAME_HERO_DOWNLOAD_OPTIONS_ID = "game-hero-download-options";
export const GAME_HERO_OPEN_SETTINGS_ID = "game-hero-open-settings";
export const GAME_HERO_OPEN_CLOUD_SAVE_ID = "game-hero-open-cloud-save";
export const GAME_HERO_TOGGLE_FAVORITE_ID = "game-hero-toggle-favorite";
export const GAME_MEDIA_CAROUSEL_REGION_ID = "game-media-carousel";
export const GAME_DESCRIPTION_REGION_ID = "game-description";
export const GAME_DESCRIPTION_BODY_ID = "game-description-body";
export const GAME_DESCRIPTION_BOTTOM_ENTRY_ID = "game-description-bottom-entry";
export const GAME_SIMILAR_GAMES_REGION_ID = "game-similar-games";
export const GAME_COMMENTS_REGION_ID = "game-comments";
export const GAME_COMMENTS_ACTION_ROWS_REGION_ID = "game-comments-action-rows";
export const GAME_COMMENTS_LOAD_MORE_ID = "game-comments-load-more";
export const GAME_SIDEBAR_REGION_ID = "game-sidebar";
export const GAME_SIDEBAR_STATS_ID = "game-sidebar-stats";
export const GAME_SIDEBAR_HLTB_ID = "game-sidebar-hltb";
export const GAME_SIDEBAR_PROTONDB_ID = "game-sidebar-protondb";
export const GAME_SIDEBAR_CONTROLLER_SUPPORT_ID =
  "game-sidebar-controller-support";
export const GAME_SIDEBAR_ACHIEVEMENTS_ID = "game-sidebar-achievements";
export const GAME_SIDEBAR_METADATA_ID = "game-sidebar-metadata";
export const GAME_SIDEBAR_REQUIREMENTS_ID = "game-sidebar-requirements";
export const GAME_SIDEBAR_LANGUAGES_ID = "game-sidebar-languages";

export function getGameMediaCarouselItemId(index: number) {
  return `game-media-carousel-item-${index}`;
}

export function getGameSimilarGameItemId(
  sourceShop: string,
  sourceObjectId: string,
  gameShop: string,
  gameObjectId: string
) {
  return `game-similar-${sourceShop}-${sourceObjectId}-${gameShop}-${gameObjectId}`;
}

export function getGameCommentVoteItemId(
  reviewId: string,
  voteType: "upvote" | "downvote"
) {
  return `game-comment-${reviewId}-${voteType}`;
}

export const GAME_MY_SCREENSHOTS_REGION_ID = "game-my-screenshots";
export const GAME_MY_SCREENSHOTS_GRID_REGION_ID = "game-my-screenshots-grid";
export const GAME_MY_SCREENSHOTS_VIEW_ALL_ID = "game-my-screenshots-view-all";
export const GAME_MY_SCREENSHOTS_RETRY_ID = "game-my-screenshots-retry";

export function getGameMyScreenshotItemId(itemId: string) {
  return `game-my-screenshot-${itemId}`;
}

export const GAME_SCREENSHOTS_MODAL_REGION_ID = "game-screenshots-modal";
export const GAME_SCREENSHOTS_MODAL_TOOLBAR_REGION_ID =
  "game-screenshots-modal-toolbar";
export const GAME_SCREENSHOTS_MODAL_GRID_REGION_ID =
  "game-screenshots-modal-grid";
export const GAME_SCREENSHOTS_MODAL_SORT_ID = "game-screenshots-modal-sort";
export const GAME_SCREENSHOTS_MODAL_SPOILERS_ID =
  "game-screenshots-modal-spoilers";
export const GAME_SCREENSHOTS_MODAL_LOAD_MORE_ID =
  "game-screenshots-modal-load-more";
export const GAME_SCREENSHOTS_MODAL_RETRY_ID = "game-screenshots-modal-retry";
export const GAME_SCREENSHOTS_MODAL_MINE_GRID_REGION_ID =
  "game-screenshots-modal-mine-grid";
export const GAME_SCREENSHOTS_MODAL_BROWSE_COMMUNITY_ID =
  "game-screenshots-modal-browse-community";
export const GAME_SCREENSHOTS_MODAL_CLOSE_ID = "game-screenshots-modal-close";
export const GAME_SCREENSHOTS_MODAL_LIST_REGION_ID =
  "game-screenshots-modal-list";
export const GAME_SCREENSHOTS_MODAL_MINE_LOAD_MORE_ID =
  "game-screenshots-modal-mine-load-more";
export const GAME_SCREENSHOTS_MODAL_MINE_RETRY_ID =
  "game-screenshots-modal-mine-retry";

export function getGameScreenshotsModalItemId(screenshotId: string) {
  return `game-screenshots-modal-item-${screenshotId}`;
}
