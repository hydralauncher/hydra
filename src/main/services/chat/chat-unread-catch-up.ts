import type { User, UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { logger } from "../logger";
import { publishChatUnreadNotification } from "../notifications";
import { WindowManager } from "../window-manager";
import { getChatSenderProfile } from "./chat-sender-profiles";
import { ChatUnreadStore } from "./chat-unread-store";
import {
  getMissedChatConversations,
  type ChatNotifiedUntil,
} from "./missed-chat-conversations";

// Kept per conversation: a live message must not mark messages that other
// friends sent while the launcher was offline as announced.
interface ChatNotificationCursor {
  userId: string;
  notifiedUntil: ChatNotifiedUntil;
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
  return cursor?.userId === userId && typeof cursor.notifiedUntil === "object"
    ? { ...cursor.notifiedUntil }
    : {};
};

// Live messages and catch-ups both move the cursor; updates run one at a time
// so neither overwrites the other.
let cursorUpdate: Promise<void> = Promise.resolve();

/**
 * Records the newest announced message of each conversation in `announced`,
 * so a later catch-up never announces those messages again.
 */
const recordAnnounced = (userId: string, announced: ChatNotifiedUntil) => {
  const update = cursorUpdate.then(async () => {
    const notifiedUntil = await readNotifiedUntil(userId);
    let isChanged = false;

    for (const [friendId, createdAt] of Object.entries(announced)) {
      const current = notifiedUntil[friendId];
      if (
        !createdAt ||
        (current && Date.parse(current) >= Date.parse(createdAt))
      ) {
        continue;
      }

      notifiedUntil[friendId] = createdAt;
      isChanged = true;
    }

    if (!isChanged) return;

    await db.put<string, ChatNotificationCursor>(
      levelKeys.chatNotificationCursor,
      { userId, notifiedUntil },
      { valueEncoding: "json" }
    );
  });

  cursorUpdate = update.catch(() => {});
  return update;
};

/** Records that the friend's messages up to `createdAt` have been announced. */
export const advanceChatNotificationCursor = (
  userId: string,
  friendId: string,
  createdAt: string
) => recordAnnounced(userId, { [friendId]: createdAt });

const announceMissedMessages = async (signal?: AbortSignal) => {
  const userId = await getSignedInUserId();
  if (!userId || signal?.aborted) return;

  const missed = getMissedChatConversations(
    ChatUnreadStore.getUnreadConversations(),
    await readNotifiedUntil(userId),
    (friendId) => WindowManager.isChatConversationOpenInFocusedWindow(friendId)
  );
  if (missed.conversations.length === 0 || signal?.aborted) return;

  await recordAnnounced(
    userId,
    Object.fromEntries(
      missed.conversations.map((conversation) => [
        conversation.friendId,
        conversation.lastMessageAt,
      ])
    )
  );

  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  if (
    signal?.aborted ||
    userPreferences?.chatMessageNotificationsEnabled === false
  ) {
    return;
  }

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

let catchUp: { task: Promise<void>; controller: AbortController } | null = null;

// Only the catch-up that is still current may clear itself.
const finishCatchUp = (controller: AbortController) => {
  if (catchUp?.controller === controller) catchUp = null;
};

/**
 * Stops a running catch-up, as on sign-out: what it would announce belongs to
 * the account that started it.
 */
export const cancelChatCatchUp = () => {
  catchUp?.controller.abort();
  catchUp = null;
};

/**
 * Reloads unread counts from the server and announces messages that arrived
 * while the launcher was closed or disconnected. Realtime never replays those.
 */
export const catchUpChatUnread = (signal?: AbortSignal) => {
  if (catchUp) return catchUp.task;

  const controller = new AbortController();
  signal?.addEventListener("abort", () => controller.abort(), { once: true });

  const task = (async () => {
    try {
      await ChatUnreadStore.refresh();
      if (!controller.signal.aborted) {
        await announceMissedMessages(controller.signal);
      }
    } catch (error) {
      logger.error("Failed to catch up on chat messages", error);
    } finally {
      finishCatchUp(controller);
    }
  })();

  catchUp = { task, controller };
  return task;
};
