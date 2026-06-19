export const GAME_PAGE_REGION_ID = "game-page";
export const GAME_HERO_ACTIONS_REGION_ID = "game-hero-actions";
export const GAME_HERO_PRIMARY_ACTION_ID = "game-hero-primary-action";
export const GAME_HERO_DOWNLOAD_OPTIONS_ID = "game-hero-download-options";
export const GAME_HERO_OPEN_SETTINGS_ID = "game-hero-open-settings";
export const GAME_HERO_TOGGLE_FAVORITE_ID = "game-hero-toggle-favorite";
export const GAME_MEDIA_CAROUSEL_REGION_ID = "game-media-carousel";
export const GAME_DESCRIPTION_REGION_ID = "game-description";
export const GAME_DESCRIPTION_BODY_ID = "game-description-body";
export const GAME_DESCRIPTION_BOTTOM_ENTRY_ID = "game-description-bottom-entry";
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

export function getGameCommentVoteItemId(
  reviewId: string,
  voteType: "upvote" | "downvote"
) {
  return `game-comment-${reviewId}-${voteType}`;
}
