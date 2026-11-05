import type { ChatConversationDto } from "@types";

import type {
  ChatConversation,
  ChatConversationLastMessage,
} from "./chat-types";

// Same limits as the main window's sidebar (components/sidebar/sidebar.tsx).
export const CHAT_SIDEBAR_MIN_WIDTH = 200;
export const CHAT_SIDEBAR_INITIAL_WIDTH = 250;
export const CHAT_SIDEBAR_MAX_WIDTH = 450;

export const CHAT_SIDEBAR_WIDTH_STORAGE_KEY = "chatSidebarWidth";

/** Room the conversation keeps next to the sidebar. */
export const CHAT_CONVERSATION_MIN_WIDTH = 200;

export function clampChatSidebarWidth(
  width: number,
  windowWidth = Number.POSITIVE_INFINITY
): number {
  if (!Number.isFinite(width)) return CHAT_SIDEBAR_INITIAL_WIDTH;
  const maxWidth = Math.min(
    CHAT_SIDEBAR_MAX_WIDTH,
    windowWidth - CHAT_CONVERSATION_MIN_WIDTH
  );
  return Math.max(
    CHAT_SIDEBAR_MIN_WIDTH,
    Math.min(Math.round(width), maxWidth)
  );
}

/**
 * The Hydra team's own conversation: one way, with announcements the user can
 * read but not answer. The API marks the account; nothing else is official.
 */
export function isOfficialAccount(
  friend: Pick<ChatConversation["friend"], "isOfficial">
): boolean {
  return friend.isOfficial === true;
}

/**
 * Most recent activity first, like WhatsApp: a sent or received message moves
 * its conversation to the top. A conversation with no message yet (just
 * opened from the picker) stays at the top until one arrives elsewhere. The
 * official conversation is pinned above them all.
 */
export function sortConversationsByActivity<
  T extends Pick<ChatConversation, "messages" | "lastMessage"> & {
    friend: Pick<ChatConversation["friend"], "isOfficial">;
  },
>(conversations: T[]): T[] {
  const activityOf = (conversation: T) => {
    const createdAt = getLatestMessage(conversation)?.createdAt;
    if (!createdAt) return Number.POSITIVE_INFINITY;
    const time = new Date(createdAt).getTime();
    return Number.isNaN(time) ? 0 : time;
  };

  return conversations
    .map((conversation, index) => ({
      conversation,
      index,
      pinned: isOfficialAccount(conversation.friend) ? 1 : 0,
      activity: activityOf(conversation),
    }))
    .sort(
      (a, b) =>
        b.pinned - a.pinned || b.activity - a.activity || a.index - b.index
    )
    .map(({ conversation }) => conversation);
}

/** Conversations whose friend's name contains the query, in their order. */
export function filterConversations<
  T extends { friend: { displayName: string } },
>(conversations: T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return conversations;

  return conversations.filter((conversation) =>
    conversation.friend.displayName.toLocaleLowerCase().includes(normalized)
  );
}

/**
 * The conversation Ctrl+Tab (step 1) or Ctrl+Shift+Tab (step -1) moves to,
 * wrapping around the ends. Null when there is no other conversation.
 */
export function getAdjacentConversationId(
  ids: string[],
  activeId: string | null,
  step: 1 | -1
): string | null {
  if (ids.length < 2) return null;

  const index = activeId === null ? -1 : ids.indexOf(activeId);
  if (index === -1) return (step === 1 ? ids[0] : ids.at(-1)) ?? null;

  return ids[(index + step + ids.length) % ids.length];
}

/** `fromMe` is by sender, since the list reports both sides' messages. */
export function toConversationLastMessage(
  dto: ChatConversationDto
): ChatConversationLastMessage {
  const { lastMessage, friendId } = dto;
  return {
    seq: lastMessage.seq,
    fromMe: lastMessage.senderId !== friendId,
    text: lastMessage.body,
    createdAt: lastMessage.createdAt,
    isHidden: Boolean(lastMessage.hidden),
    attachmentCount: lastMessage.attachmentCount ?? 0,
  };
}

export type ChatConversationPreview =
  | { kind: "text"; text: string; fromMe: boolean }
  | { kind: "images"; count: number; fromMe: boolean }
  | { kind: "removed" }
  | null;

/**
 * The newest message the window knows of: the loaded (or live) history's
 * last message, else the one the conversation list reported.
 */
export function getLatestMessage(
  conversation: Pick<ChatConversation, "messages" | "lastMessage">
): ChatConversationLastMessage | null {
  const last = conversation.messages.at(-1);
  const listed = conversation.lastMessage ?? null;

  if (!last) return listed;
  // A pending message has no seq yet: it is newer than anything stored.
  if (listed && last.seq !== undefined && last.seq < listed.seq) return listed;

  return {
    seq: last.seq ?? Number.MAX_SAFE_INTEGER,
    fromMe: last.fromMe,
    text: last.text,
    createdAt: last.createdAt,
    isHidden: Boolean(last.isHidden),
    attachmentCount: last.attachments?.length ?? 0,
  };
}

/** What the sidebar row shows under the name: the latest message, if any. */
export function getConversationPreview(
  conversation: Pick<ChatConversation, "messages" | "lastMessage">
): ChatConversationPreview {
  const latest = getLatestMessage(conversation);
  if (!latest) return null;

  if (latest.isHidden) return { kind: "removed" };

  const text = latest.text.replace(/\s+/g, " ").trim();
  if (text) return { kind: "text", text, fromMe: latest.fromMe };

  if (latest.attachmentCount > 0) {
    return {
      kind: "images",
      count: latest.attachmentCount,
      fromMe: latest.fromMe,
    };
  }

  return null;
}

/**
 * Drops conversations opened from the picker and left without a message,
 * draft or unread message once another one is active.
 */
export function dropAbandonedConversations<
  T extends Pick<
    ChatConversation,
    "messages" | "lastMessage" | "draft" | "draftImages" | "unreadCount"
  > & { friend: Pick<ChatConversation["friend"], "id"> },
>(
  conversations: T[],
  activeId: string | null,
  keepIds: ReadonlySet<string> = new Set()
): T[] {
  const kept = conversations.filter(
    (conversation) =>
      conversation.friend.id === activeId ||
      keepIds.has(conversation.friend.id) ||
      conversation.messages.length > 0 ||
      conversation.lastMessage !== undefined ||
      conversation.unreadCount > 0 ||
      conversation.draft.trim() !== "" ||
      conversation.draftImages.length > 0
  );

  return kept.length === conversations.length ? conversations : kept;
}
