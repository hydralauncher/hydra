export interface UnreadChatConversation {
  friendId: string;
  unreadCount: number;
  lastMessageAt: string;
}

/** The newest announced message in each conversation, by friend id. */
export type ChatNotifiedUntil = Partial<Record<string, string>>;

/**
 * Unread conversations whose newest message is newer than the last one
 * announced in that conversation, skipping conversations the user is already
 * looking at.
 */
export const getMissedChatConversations = (
  conversations: UnreadChatConversation[],
  notifiedUntil: ChatNotifiedUntil,
  isOpenInFocusedChatWindow: (friendId: string) => boolean
) => {
  const missed = conversations.filter((conversation) => {
    const announcedAt = notifiedUntil[conversation.friendId];

    return (
      conversation.unreadCount > 0 &&
      (!announcedAt ||
        Date.parse(conversation.lastMessageAt) > Date.parse(announcedAt)) &&
      !isOpenInFocusedChatWindow(conversation.friendId)
    );
  });

  return {
    conversations: missed,
    messageCount: missed.reduce(
      (total, conversation) => total + conversation.unreadCount,
      0
    ),
  };
};
