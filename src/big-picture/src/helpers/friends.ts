import type { UserFriend } from "@types";

// Some endpoints omit isOnline, but an active game session implies online.
export const isFriendOnline = (friend: UserFriend) =>
  Boolean(friend.isOnline) || friend.currentGame !== null;

export const sortFriendsByOnlineStatus = (friends: UserFriend[]) =>
  [...friends].sort(
    (a, b) => Number(isFriendOnline(b)) - Number(isFriendOnline(a))
  );
