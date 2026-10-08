import type { User, UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { logger } from "../logger";
import { publishChatUnreadNotification } from "../notifications";
import { WindowManager } from "../window-manager";
import { getChatSenderProfile } from "./chat-sender-profiles";
import { ChatUnreadStore } from "./chat-unread-store";
import { getMissedChatConversations } from "./missed-chat-conversations";

interface ChatNotificationCursor {
  userId: string;
  notifiedUntil: string;
}

const getSignedInUserId = async () => {
  const user = await db
    .get<string, User | null>(levelKeys.user, { valueEncoding: "json" })
    .catch(() => null);
  return user?.id ?? null;
};

const readNotifiedUntil = async (userId: string) => {
  const cursor = await db
    .get<
      string,
      ChatNotificationCursor | null
    >(levelKeys.chatNotificationCursor, { valueEncoding: "json" })
    .catch(() => null);
  return cursor?.userId === userId ? cursor.notifiedUntil : null;
};

/**
 * Records that every chat message up to `createdAt` has been announced, so a
 * later catch-up never announces it again.
 */
export const advanceChatNotificationCursor = async (
  userId: string,
  createdAt: string
) => {
  const notifiedUntil = await readNotifiedUntil(userId);
  if (notifiedUntil && Date.parse(notifiedUntil) >= Date.parse(createdAt)) {
    return;
  }

  await db.put<string, ChatNotificationCursor>(
    levelKeys.chatNotificationCursor,
    { userId, notifiedUntil: createdAt },
    { valueEncoding: "json" }
  );
};

const announceMissedMessages = async (signal?: AbortSignal) => {
  const userId = await getSignedInUserId();
  if (!userId || signal?.aborted) return;

  const missed = getMissedChatConversations(
    ChatUnreadStore.getUnreadConversations(),
    await readNotifiedUntil(userId),
    (friendId) => WindowManager.isChatConversationOpenInFocusedWindow(friendId)
  );
  if (missed.conversations.length === 0 || signal?.aborted) return;

  await advanceChatNotificationCursor(userId, missed.latestMessageAt);

  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  if (userPreferences?.chatMessageNotificationsEnabled === false) return;

  if (missed.conversations.length === 1) {
    const [conversation] = missed.conversations;
    const sender = await getChatSenderProfile(conversation.friendId, signal);
    if (signal?.aborted) return;

    await publishChatUnreadNotification(
      { kind: "friend", sender, messageCount: conversation.unreadCount },
      () => WindowManager.openChatWindow(sender),
      signal
    );
    return;
  }

  await publishChatUnreadNotification(
    {
      kind: "summary",
      friendCount: missed.conversations.length,
      messageCount: missed.messageCount,
    },
    () => WindowManager.openFriendsWindow(),
    signal
  );
};

let catchUpInFlight: Promise<void> | null = null;

/**
 * Reloads unread counts from the server and announces messages that arrived
 * while the launcher was closed or disconnected. Realtime never replays those.
 */
export const catchUpChatUnread = (signal?: AbortSignal) => {
  catchUpInFlight ??= (async () => {
    try {
      await ChatUnreadStore.refresh();
      await announceMissedMessages(signal);
    } catch (error) {
      logger.error("Failed to catch up on chat messages", error);
    } finally {
      catchUpInFlight = null;
    }
  })();

  return catchUpInFlight;
};
