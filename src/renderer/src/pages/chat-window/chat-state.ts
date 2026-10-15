import type {
  ChatAttachmentDto,
  ChatMessageDto,
  ChatPendingMessageDto,
  ChatReactionDto,
} from "@types";

import type {
  ChatAttachment,
  ChatMessage,
  ChatMessageReply,
  ChatMessageStatus,
  ChatReaction,
} from "./chat-message-groups";
import { mergeReactions } from "./chat-reactions.js";

export const toChatAttachments = (
  dtos: ChatAttachmentDto[]
): ChatAttachment[] =>
  dtos.map((dto) => ({
    id: dto.id,
    contentType: dto.contentType,
    width: dto.width,
    height: dto.height,
    spoiler: dto.spoiler,
    url: dto.url,
  }));

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
            ...(dto.replyTo.hidden ? { isHidden: true } : {}),
            ...(dto.replyTo.attachmentCount
              ? { attachmentCount: dto.replyTo.attachmentCount }
              : {}),
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
    ...(dto.hidden ? { isHidden: true } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(dto.reactions
      ? { reactions: toChatReactions(dto.reactions, friendId) }
      : {}),
    ...(dto.attachments?.length
      ? { attachments: toChatAttachments(dto.attachments) }
      : {}),
    ...(fromHistory ? { fromHistory } : {}),
  };
};

/** The user's own message with images that the server still holds. */
export const toPendingChatMessage = (
  dto: ChatPendingMessageDto
): ChatMessage => ({
  id: dto.clientNonce,
  clientNonce: dto.clientNonce,
  fromMe: true,
  text: dto.body,
  createdAt: dto.createdAt,
  status: dto.status,
  ...(dto.replyToSeq ? { replyTo: { seq: dto.replyToSeq } } : {}),
  attachments: toChatAttachments(dto.attachments),
  fromHistory: true,
});

/**
 * Only stored messages can be replied to: the reply points at their seq.
 * Removed ones can't.
 */
export const createReply = (target: ChatMessage): ChatMessageReply | null =>
  target.seq === undefined || target.isHidden
    ? null
    : {
        seq: target.seq,
        quoted: {
          fromMe: target.fromMe,
          text: target.text,
          ...(target.attachments?.length
            ? { attachmentCount: target.attachments.length }
            : {}),
        },
      };

export const createPendingMessage = (
  text: string,
  clientNonce: string,
  createdAt = new Date().toISOString(),
  replyTo: ChatMessageReply | null = null,
  attachments: ChatAttachment[] = []
): ChatMessage => ({
  id: clientNonce,
  clientNonce,
  fromMe: true,
  text,
  createdAt,
  status: "pending",
  ...(replyTo ? { replyTo } : {}),
  ...(attachments.length > 0 ? { attachments, uploadProgress: 0 } : {}),
});

/**
 * Keeps the sender's local copies on the stored images, so they don't reload
 * from the server. Attachments match by id, else by position: the local ids
 * are only replaced once the uploads are reserved.
 */
const keepLocalCopies = (
  incoming: ChatAttachment[] | undefined,
  existing: ChatAttachment[] | undefined
) =>
  incoming?.map((attachment, index) => {
    const previous =
      existing?.find((current) => current.id === attachment.id) ??
      (existing?.length === incoming.length ? existing[index] : undefined);
    if (!previous?.localUrl) return attachment;

    return {
      ...attachment,
      localUrl: previous.localUrl,
      width: attachment.width ?? previous.width,
      height: attachment.height ?? previous.height,
    };
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
    let merged = existing?.reactions
      ? {
          ...message,
          // Realtime messages carry no reactions; keep the ones already known.
          reactions: message.reactions
            ? mergeReactions(existing.reactions, message.reactions)
            : existing.reactions,
        }
      : message;
    if (existing?.attachments && merged.attachments) {
      merged = {
        ...merged,
        attachments: keepLocalCopies(merged.attachments, existing.attachments),
      };
    }
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

/**
 * Removes the message with `seq`, or puts it back with its `text` when `text`
 * is set, along with the quotes of it in replies.
 */
export const setMessageVisibility = (
  messages: ChatMessage[],
  seq: number,
  text: string | null
): ChatMessage[] =>
  messages.map((message) => {
    let next = message;

    if (message.seq === seq) {
      next = { ...message, text: text ?? "" };
      if (text === null) {
        next.isHidden = true;
        // Removed images keep their size for the placeholder, not their URL.
        if (next.attachments) {
          next.attachments = next.attachments.map((attachment) => ({
            ...attachment,
            url: null,
            localUrl: undefined,
          }));
        }
      } else delete next.isHidden;
    }

    const quoted = next.replyTo?.seq === seq ? next.replyTo.quoted : undefined;
    if (next.replyTo && quoted) {
      next = {
        ...next,
        replyTo: {
          ...next.replyTo,
          quoted:
            text === null
              ? { ...quoted, text: "", isHidden: true }
              : {
                  fromMe: quoted.fromMe,
                  text,
                  ...(quoted.attachmentCount
                    ? { attachmentCount: quoted.attachmentCount }
                    : {}),
                },
        },
      };
    }

    return next;
  });

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

export const setMessageFailed = (
  messages: ChatMessage[],
  clientNonce: string,
  failure?: ChatMessage["failure"]
) =>
  messages.map((message) =>
    message.clientNonce === clientNonce && message.seq === undefined
      ? { ...message, status: "failed" as const, failure }
      : message
  );

const updateUnsent = (
  messages: ChatMessage[],
  clientNonce: string,
  update: (message: ChatMessage) => ChatMessage
) =>
  messages.map((message) =>
    message.clientNonce === clientNonce && message.seq === undefined
      ? update(message)
      : message
  );

export const setMessageUploadProgress = (
  messages: ChatMessage[],
  clientNonce: string,
  uploadProgress: number
) =>
  updateUnsent(messages, clientNonce, (message) =>
    message.uploadProgress === uploadProgress
      ? message
      : { ...message, uploadProgress }
  );

/** Swaps the local attachment ids for the ones the server reserved. */
export const setMessageAttachmentIds = (
  messages: ChatMessage[],
  clientNonce: string,
  ids: string[]
) =>
  updateUnsent(messages, clientNonce, (message) => ({
    ...message,
    attachments: message.attachments?.map((attachment, index) => ({
      ...attachment,
      id: ids[index] ?? attachment.id,
    })),
  }));

/**
 * Moves a message on from `pending` once its request settles, unless a
 * realtime event already did.
 */
export const settleSendingMessage = (
  messages: ChatMessage[],
  clientNonce: string,
  status: ChatMessageStatus
) =>
  updateUnsent(messages, clientNonce, (message) => {
    if (message.status !== "pending") return message;

    const { uploadProgress: _uploadProgress, ...settled } = message;
    return { ...settled, status };
  });

export const removeUnsentMessage = (
  messages: ChatMessage[],
  clientNonce: string
) =>
  messages.filter(
    (message) =>
      message.clientNonce !== clientNonce || message.seq !== undefined
  );

/**
 * Applies the server's view of the user's held messages. One still uploading
 * or posting here keeps its local state: the server's copy is older.
 */
export const mergePendingMessages = (
  current: ChatMessage[],
  pending: ChatMessage[]
) => {
  const inFlight = new Set(
    current
      .filter(
        (message) => message.seq === undefined && message.status === "pending"
      )
      .map((message) => message.clientNonce)
  );
  const delivered = new Set(
    current
      .filter((message) => message.seq !== undefined)
      .map((message) => message.clientNonce)
  );

  return mergeChatMessages(
    current,
    pending.filter(
      (message) =>
        !inFlight.has(message.clientNonce) &&
        !delivered.has(message.clientNonce)
    )
  );
};

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
