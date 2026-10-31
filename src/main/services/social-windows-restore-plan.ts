import type {
  SocialWindowKind,
  SocialWindowsSession,
  UserFriend,
  UserPreferences,
} from "@types";

export const getSocialWindowsRestorePlan = (
  session: Partial<SocialWindowsSession> | null | undefined,
  userPreferences: UserPreferences | null | undefined
) => {
  const chatFriends = Array.isArray(session?.chatFriends)
    ? session.chatFriends
    : [];
  const openFriendsWindow = Boolean(
    session?.friendsWindowOpen || userPreferences?.openFriendsWindowOnStartup
  );

  return {
    openFriendsWindow,
    chatFriends,
    activeChatFriendId: session?.activeChatFriendId ?? null,
    showOrder: getSocialWindowsShowOrder(
      openFriendsWindow,
      chatFriends.length > 0,
      session?.topWindow ?? null
    ),
  };
};

export const getSocialWindowsShowOrder = (
  openFriendsWindow: boolean,
  openChatWindow: boolean,
  topWindow: SocialWindowKind | null
): SocialWindowKind[] => {
  const windows: SocialWindowKind[] = [];
  if (openFriendsWindow) windows.push("friends");
  if (openChatWindow) windows.push("chat");

  return topWindow === "friends" ? windows.toReversed() : windows;
};

export const getTopSocialWindow = (
  isFriendsWindowOpen: boolean,
  isChatWindowOpen: boolean,
  lastFocused: SocialWindowKind | null
): SocialWindowKind | null => {
  if (isFriendsWindowOpen && isChatWindowOpen) return lastFocused ?? "chat";
  if (isChatWindowOpen) return "chat";
  if (isFriendsWindowOpen) return "friends";
  return null;
};

export const orderChatFriends = (
  openFriendIds: string[],
  openFriends: UserFriend[]
) => {
  const friendsById = new Map(openFriends.map((friend) => [friend.id, friend]));

  return openFriendIds
    .map((friendId) => friendsById.get(friendId))
    .filter((friend): friend is UserFriend => Boolean(friend));
};
