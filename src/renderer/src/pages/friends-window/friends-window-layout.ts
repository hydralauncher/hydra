import type { UserFriend } from "@types";

export const FRIENDS_WINDOW_MIN_WIDTH = 420;
const BANNER_WIDTH_STEP = 120;
const PROFILE_BACKGROUND_HEIGHT = 180;
const FRIEND_BACKGROUND_HEIGHT = 96;
const FRIEND_BACKGROUND_EXTRA_WIDTH = 60;

export const getBannerWidth = (windowWidth: number) => {
  const extraWidth = Math.max(0, windowWidth - FRIENDS_WINDOW_MIN_WIDTH);

  return (
    FRIENDS_WINDOW_MIN_WIDTH +
    Math.ceil(extraWidth / BANNER_WIDTH_STEP) * BANNER_WIDTH_STEP
  );
};

export const getBackgroundImageSizes = (bannerWidth: number) => ({
  profile: { width: bannerWidth, height: PROFILE_BACKGROUND_HEIGHT },
  friend: {
    width: bannerWidth + FRIEND_BACKGROUND_EXTRA_WIDTH,
    height: FRIEND_BACKGROUND_HEIGHT,
  },
});

export const sortFriendsByUnreadMessages = (
  friends: UserFriend[],
  unreadByFriend: Record<string, number>,
  lastMessageAtByFriend: Record<string, string>
) => {
  const lastMessageTime = (friendId: string) => {
    const time = Date.parse(lastMessageAtByFriend[friendId] ?? "");
    return Number.isNaN(time) ? 0 : time;
  };

  const withUnread = friends
    .filter((friend) => (unreadByFriend[friend.id] ?? 0) > 0)
    .toSorted((a, b) => lastMessageTime(b.id) - lastMessageTime(a.id));
  const withoutUnread = friends.filter(
    (friend) => (unreadByFriend[friend.id] ?? 0) <= 0
  );

  return [...withUnread, ...withoutUnread];
};
