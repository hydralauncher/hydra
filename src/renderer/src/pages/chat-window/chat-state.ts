import type { ChatMessageDto, ChatReactionDto } from "@types";

import type {
  ChatMessage,
  ChatMessageReply,
  ChatMessageStatus,
  ChatReaction,
} from "./chat-message-groups";
import { mergeReactions } from "./chat-reactions.js";

export const toChatReactions = (
  dtos: ChatReactionDto[],
  friendId: string
): ChatReaction[] =>
  dtos.map((dto) => ({
    emoji: dto.emoji,
    fromMe: dto.userId !== friendId,
    updatedAt: dto.updatedAt,
  }));

const toChatMessageReply = (
  dto: ChatMessageDto,
  friendId: string
): ChatMessageReply | null => {
  if (!dto.replyToSeq) return null;

  return {
    seq: dto.replyToSeq,
    ...(dto.replyTo
      ? {
          quoted: {
            fromMe: dto.replyTo.senderId !== friendId,
            text: dto.replyTo.body,
          },
        }
      : {}),
  };
};

export const toChatMessage = (
  dto: ChatMessageDto,
  friendId: string,
  fromHistory = false
): ChatMessage => {
  const replyTo = toChatMessageReply(dto, friendId);

  return {
    id: dto.clientNonce,
    clientNonce: dto.clientNonce,
    seq: dto.seq,
    fromMe: dto.senderId !== friendId,
    text: dto.body,
    createdAt: dto.createdAt,
    status: "sent",
    ...(replyTo ? { replyTo } : {}),
    ...(dto.reactions
      ? { reactions: toChatReactions(dto.reactions, friendId) }
      : {}),
    ...(fromHistory ? { fromHistory } : {}),
  };
};

/** Only stored messages can be replied to: the reply points at their seq. */
export const createReply = (target: ChatMessage): ChatMessageReply | null =>
  target.seq === undefined
    ? null
    : {
        seq: target.seq,
        quoted: { fromMe: target.fromMe, text: target.text },
      };

export const createPendingMessage = (
  text: string,
  clientNonce: string,
  createdAt = new Date().toISOString(),
  replyTo: ChatMessageReply | null = null
): ChatMessage => ({
  id: clientNonce,
  clientNonce,
  fromMe: true,
  text,
  createdAt,
  status: "pending",
  ...(replyTo ? { replyTo } : {}),
});

/**
 * Merges stored messages into a conversation. A stored message replaces the
 * optimistic copy with the same nonce, duplicates collapse, stored messages
 * stay in seq order and unsent ones stay after them in the order they were
 * written.
 */
export const mergeChatMessages = (
  current: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] => {
  const byNonce = new Map(
    current.map((message) => [message.clientNonce, message])
  );
  for (const message of incoming) {
    const existing = byNonce.get(message.clientNonce);
    const merged = existing?.reactions
      ? {
          ...message,
          // Realtime messages carry no reactions; keep the ones already known.
          reactions: message.reactions
            ? mergeReactions(existing.reactions, message.reactions)
            : existing.reactions,
        }
      : message;
    byNonce.set(
      message.clientNonce,
      existing?.fromHistory ? { ...merged, fromHistory: true } : merged
    );
  }

  const messages = [...byNonce.values()];
  const stored = messages
    .filter((message) => message.seq !== undefined)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const unsent = messages.filter((message) => message.seq === undefined);

  return [...stored, ...unsent];
};

export const setMessageStatus = (
  messages: ChatMessage[],
  clientNonce: string,
  status: ChatMessageStatus
) =>
  messages.map((message) =>
    message.clientNonce === clientNonce && message.seq === undefined
      ? { ...message, status }
      : message
  );

export const getLatestSeq = (messages: ChatMessage[]) =>
  messages.reduce((latest, message) => Math.max(latest, message.seq ?? 0), 0);

/** True when messages between what is loaded and `seq` were never received. */
export const hasGapBefore = (messages: ChatMessage[], seq: number) => {
  const latestSeq = getLatestSeq(messages);
  return latestSeq > 0 && seq > latestSeq + 1;
};

/**
 * Seq of the last message before missed ones, when a message with `seq`
 * arrives: the gap already recorded, else the newest loaded message if `seq`
 * skips past it.
 */
export const findGapAfter = (
  conversation: { messages: ChatMessage[]; gapAfterSeq: number | null },
  seq: number
) =>
  conversation.gapAfterSeq ??
  (hasGapBefore(conversation.messages, seq)
    ? getLatestSeq(conversation.messages)
    : null);

/** Messages from the friend after the one with `messageId`; 0 once it is gone. */
export const countFriendMessagesAfter = (
  messages: ChatMessage[],
  messageId: string
) => {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) return 0;

  return messages.slice(index + 1).filter((message) => !message.fromMe).length;
};

/** The friend's first message after the one with `messageId`, if any. */
export const findFirstFriendMessageAfter = (
  messages: ChatMessage[],
  messageId: string
) => {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) return null;

  return messages.slice(index + 1).find((message) => !message.fromMe) ?? null;
};
