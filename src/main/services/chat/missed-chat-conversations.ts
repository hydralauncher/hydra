export interface UnreadChatConversation {
  friendId: string;
  unreadCount: number;
  lastMessageAt: string;
}

/**
 * Unread conversations whose newest message is newer than the last one
 * announced, skipping conversations the user is already looking at.
 */
export const getMissedChatConversations = (
  conversations: UnreadChatConversation[],
  notifiedUntil: string | null,
  isOpenInFocusedChatWindow: (friendId: string) => boolean
) => {
  const since = notifiedUntil ? Date.parse(notifiedUntil) : 0;

  const missed = conversations.filter(
    (conversation) =>
      conversation.unreadCount > 0 &&
      Date.parse(conversation.lastMessageAt) > since &&
      !isOpenInFocusedChatWindow(conversation.friendId)
  );

  const latest = missed.reduce<UnreadChatConversation | null>(
    (newest, conversation) =>
      !newest ||
      Date.parse(conversation.lastMessageAt) > Date.parse(newest.lastMessageAt)
        ? conversation
        : newest,
    null
  );

  return {
    conversations: missed,
    messageCount: missed.reduce(
      (total, conversation) => total + conversation.unreadCount,
      0
    ),
    latestMessageAt: latest?.lastMessageAt ?? "",
  };
};
