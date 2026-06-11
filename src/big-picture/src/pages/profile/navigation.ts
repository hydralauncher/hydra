export const PROFILE_PAGE_REGION_ID = "profile-page";
export const PROFILE_HERO_ACTIONS_REGION_ID = "profile-hero-actions";
export const PROFILE_HERO_SIGN_OUT_BUTTON_ID = "profile-hero-sign-out";
export const PROFILE_HERO_EXTERNAL_PRIMARY_ACTION_ID =
  "profile-hero-external-primary";
export const PROFILE_HERO_EXTERNAL_SECONDARY_ACTION_ID =
  "profile-hero-external-secondary";
export const PROFILE_RECENT_ACTIVITY_REGION_ID = "profile-recent-activity";
export const PROFILE_LIBRARY_CAROUSEL_REGION_ID = "profile-library-carousel";
export const PROFILE_SOCIAL_REGION_ID = "profile-social";
export const PROFILE_ACHIEVEMENTS_REGION_ID = "profile-achievements";
export const PROFILE_FRIENDS_REGION_ID = "profile-friends";
export const PROFILE_FRIENDS_VIEW_ALL_ID = "profile-friends-view-all";

export const getProfileActivityItemId = (gameKey: string) =>
  `profile-activity-${gameKey}`;

export const getProfileAchievementGameItemId = (gameKey: string) =>
  `profile-achievement-${gameKey}`;

export const getProfileFriendItemId = (friendId: string) =>
  `profile-friend-${friendId}`;
