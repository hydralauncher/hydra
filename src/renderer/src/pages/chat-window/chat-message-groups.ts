/**
 * `pending` is a message on its way (images uploading), `checking` one with
 * images the server holds until they pass moderation, and `blocked` one the
 * check turned away.
 */
export type ChatMessageStatus =
  | "sent"
  | "pending"
  | "checking"
  | "blocked"
  | "failed";

export interface ChatMessageReply {
  seq: number;
  /** Unset once the replied-to message is past chat retention. */
  quoted?: {
    fromMe: boolean;
    /** Empty while the replied-to message is removed, or images only. */
    text: string;
    /** Removed by moderation. */
    isHidden?: boolean;
    /** Images on the replied-to message. */
    attachmentCount?: number;
  };
}

export interface ChatAttachment {
  /** The server's id; a local one until its upload is reserved. */
  id: string;
  contentType: string;
  width: number | null;
  height: number | null;
  spoiler: boolean;
  /** Null while removed by moderation, or before the upload. */
  url: string | null;
  /** The sender's own copy, kept past delivery so the image doesn't reload. */
  localUrl?: string;
}

export interface ChatReaction {
  /** Null once the side removed its reaction, kept for the time of the change. */
  emoji: string | null;
  fromMe: boolean;
  updatedAt: string;
  /** Set on the user's own reaction while it is being saved. */
  isPending?: boolean;
}

export interface ChatMessage {
  /** The client nonce, so the React key survives the pending → sent swap. */
  id: string;
  clientNonce: string;
  /** Position in the conversation; unset until the server stores the message. */
  seq?: number;
  fromMe: boolean;
  /** Empty while the message is removed. */
  text: string;
  createdAt: string;
  status: ChatMessageStatus;
  /** Removed by moderation: shown as a placeholder, with no actions. */
  isHidden?: boolean;
  replyTo?: ChatMessageReply;
  /** Oldest first, at most one from each side, removals included. */
  reactions?: ChatReaction[];
  /** Loaded from history rather than sent or received live: no entrance animation. */
  fromHistory?: boolean;
  /** Images, in the order they were sent. */
  attachments?: ChatAttachment[];
  /** Share of the images uploaded, 0 to 1, while the status is `pending`. */
  uploadProgress?: number;
  /** Why a `failed` message failed, when the user can do something about it. */
  failure?: "daily_limit";
}

export interface ChatMessageGroup {
  key: string;
  fromMe: boolean;
  messages: ChatMessage[];
}

export interface ChatMessageDay {
  key: string;
  date: Date;
  groups: ChatMessageGroup[];
}

/** Consecutive messages from the same sender further apart than this start a new group. */
const GROUP_GAP_MS = 5 * 60 * 1000;

/** `splitBeforeId` starts a new group at that message, for the "New messages" divider. */
export function groupChatMessages(
  messages: ChatMessage[],
  splitBeforeId: string | null = null
): ChatMessageDay[] {
  const days: ChatMessageDay[] = [];

  for (const message of messages) {
    const date = new Date(message.createdAt);
    const dayKey = date.toDateString();

    let day = days.at(-1);
    if (day?.key !== dayKey) {
      day = { key: dayKey, date, groups: [] };
      days.push(day);
    }

    const group = day.groups.at(-1);
    const previous = group?.messages.at(-1);

    if (
      group &&
      previous &&
      message.id !== splitBeforeId &&
      group.fromMe === message.fromMe &&
      date.getTime() - new Date(previous.createdAt).getTime() <= GROUP_GAP_MS
    ) {
      group.messages.push(message);
    } else {
      day.groups.push({
        key: message.id,
        fromMe: message.fromMe,
        messages: [message],
      });
    }
  }

  return days;
}
