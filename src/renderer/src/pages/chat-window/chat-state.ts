import type { ChatMessageDto } from "@types";

import type { ChatMessage, ChatMessageStatus } from "./chat-message-groups";

export const toChatMessage = (
  dto: ChatMessageDto,
  friendId: string,
  fromHistory = false
): ChatMessage => ({
  id: dto.clientNonce,
  clientNonce: dto.clientNonce,
  seq: dto.seq,
  fromMe: dto.senderId !== friendId,
  text: dto.body,
  createdAt: dto.createdAt,
  status: "sent",
  ...(fromHistory ? { fromHistory } : {}),
});

export const createPendingMessage = (
  text: string,
  clientNonce: string,
  createdAt = new Date().toISOString()
): ChatMessage => ({
  id: clientNonce,
  clientNonce,
  fromMe: true,
  text,
  createdAt,
  status: "pending",
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
    byNonce.set(
      message.clientNonce,
      existing?.fromHistory ? { ...message, fromHistory: true } : message
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
