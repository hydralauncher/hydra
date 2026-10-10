import type { ChatMessageSync, User, UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { advanceChatNotificationCursor } from "@main/services/chat/chat-unread-catch-up";
import { ChatUnreadStore } from "@main/services/chat/chat-unread-store";
import { getChatSenderProfile } from "@main/services/chat/chat-sender-profiles";
import { shouldNotifyChatMessage } from "@main/services/chat/should-notify-chat-message";
import { logger } from "@main/services/logger";
import { publishChatMessageNotification } from "@main/services/notifications";
import { WindowManager } from "@main/services/window-manager";
import type { ChatMessage } from "../types";

const notifyChatMessage = async (
  friendId: string,
  body: string,
  signal: AbortSignal
) => {
  const sender = await getChatSenderProfile(friendId, signal);
  if (signal.aborted) return;

  WindowManager.showIncomingChatMessage(sender);

  await publishChatMessageNotification(
    sender,
    body,
    () => WindowManager.openChatWindow(sender),
    signal
  );
};

export const chatMessageEvent = async (
  payload: ChatMessage,
  signal: AbortSignal
) => {
  if (signal.aborted) return;

  const user = await db
    .get<string, User | null>(levelKeys.user, { valueEncoding: "json" })
    .catch(() => null);
  if (!user?.id || signal.aborted) return;

  const fromMe = payload.senderId === user.id;
  const friendId = fromMe ? payload.recipientId : payload.senderId;

  WindowManager.sendToAppWindows("on-chat-message", {
    friendId,
    message: {
      seq: payload.seq,
      senderId: payload.senderId,
      body: payload.body,
      clientNonce: payload.clientNonce,
      createdAt: payload.createdAt,
      replyToSeq: payload.replyToSeq ?? null,
      replyTo: payload.replyTo ?? null,
    },
  } satisfies ChatMessageSync);

  if (fromMe) return;

  const isNewMessage = ChatUnreadStore.registerIncoming(
    friendId,
    payload.seq,
    payload.createdAt,
    !WindowManager.isChatConversationVisible(friendId)
  );

  if (isNewMessage) {
    await advanceChatNotificationCursor(
      user.id,
      friendId,
      payload.createdAt
    ).catch((error) =>
      logger.error("Failed to record announced chat message", error)
    );
  }

  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  if (signal.aborted) return;

  const shouldNotify = shouldNotifyChatMessage({
    notificationsEnabled:
      userPreferences?.chatMessageNotificationsEnabled !== false,
    fromMe,
    isNewMessage,
    isOpenInFocusedChatWindow:
      WindowManager.isChatConversationOpenInFocusedWindow(friendId),
  });
  if (!shouldNotify) return;

  // A failed notification must not fail the event: the client would treat it
  // as a lost event and resync every scope.
  await notifyChatMessage(friendId, payload.body, signal).catch((error) =>
    logger.error("Failed to show chat message notification", error)
  );
};
