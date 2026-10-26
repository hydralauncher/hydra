import type { UserFriend } from "@types";

const BACKGROUND_IMAGE_SCALE = 2;

export const BACKGROUND_IMAGE_SIZES = {
  profile: {
    width: 420 * BACKGROUND_IMAGE_SCALE,
    height: 180 * BACKGROUND_IMAGE_SCALE,
  },
  friend: {
    width: 480 * BACKGROUND_IMAGE_SCALE,
    height: 96 * BACKGROUND_IMAGE_SCALE,
  },
};

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
