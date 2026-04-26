export const GAME_HERO_ACTIONS_REGION_ID = "game-hero-actions";
export const GAME_HERO_PRIMARY_ACTION_ID = "game-hero-primary-action";
export const GAME_HERO_TOGGLE_FAVORITE_ID = "game-hero-toggle-favorite";
export const GAME_SCREENSHOT_CAROUSEL_DOTS_REGION_ID =
  "game-screenshot-carousel-dots";
export const GAME_SCREENSHOT_CAROUSEL_PREV_BUTTON_ID =
  "game-screenshot-carousel-prev-button";
export const GAME_SCREENSHOT_CAROUSEL_NEXT_BUTTON_ID =
  "game-screenshot-carousel-next-button";
export const GAME_STATS_REGION_ID = "game-stats";
export const GAME_STATS_TITLE_ID = "game-stats-title";
export const GAME_HOW_LONG_TO_BEAT_TITLE_ID = "game-how-long-to-beat-title";
export const GAME_ACHIEVEMENTS_TITLE_ID = "game-achievements-title";
export const GAME_ACHIEVEMENTS_VIEW_ALL_ID = "game-achievements-view-all";
export const GAME_REQUIREMENTS_TO_PLAY_BUTTONS_REGION_ID =
  "game-requirements-to-play-buttons";
export const GAME_REQUIREMENTS_TO_PLAY_MINIMUM_BUTTON_ID =
  "game-requirements-to-play-minimum-button";
export const GAME_REQUIREMENTS_TO_PLAY_RECOMMENDED_BUTTON_ID =
  "game-requirements-to-play-recommended-button";
export const GAME_SUPPORTED_LANGUAGES_TITLE_ID =
  "game-supported-languages-title";
export const GAME_SUPPORTED_LANGUAGES_LAST_ROW_ID =
  "game-supported-languages-last-row";
export const GAME_REVIEWS_REGION_ID = "game-reviews";
export const GAME_REVIEWS_SORT_OPTIONS_REGION_ID = "game-reviews-sort-options";
export const GAME_REVIEWS_PRIMARY_FILTER_BUTTON_ID =
  "game-reviews-primary-filter-button";
export const GAME_REVIEWS_SECONDARY_FILTER_BUTTON_ID =
  "game-reviews-secondary-filter-button";
export const GAME_REVIEWS_THIRD_FILTER_BUTTON_ID =
  "game-reviews-third-filter-button";
export const GAME_REVIEWS_LOAD_MORE_ID = "game-reviews-load-more";

export function getGameReviewVotesRegionId(reviewId: string) {
  return `game-review-votes-${reviewId}`;
}

export function getGameReviewFirstVoteButtonId(reviewId?: string | null) {
  if (!reviewId) return null;

  return getGameReviewVoteButtonUpvoteId(reviewId);
}

export function getGameReviewVoteButtonUpvoteId(reviewId: string) {
  return `game-review-vote-button-upvote-${reviewId}`;
}

export function getGameReviewVoteButtonDownvoteId(reviewId: string) {
  return `game-review-vote-button-downvote-${reviewId}`;
}
