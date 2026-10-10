export type ChatMessageStatus = "sent" | "pending" | "failed";

export interface ChatMessageReply {
  seq: number;
  /** Unset once the replied-to message is past chat retention. */
  quoted?: { fromMe: boolean; text: string };
}

export interface ChatReaction {
  emoji: string;
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
  text: string;
  createdAt: string;
  status: ChatMessageStatus;
  replyTo?: ChatMessageReply;
  /** Oldest first, at most one from each side. */
  reactions?: ChatReaction[];
  /** Loaded from history rather than sent or received live: no entrance animation. */
  fromHistory?: boolean;
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

    let day = days[days.length - 1];
    if (!day || day.key !== dayKey) {
      day = { key: dayKey, date, groups: [] };
      days.push(day);
    }

    const group = day.groups[day.groups.length - 1];
    const previous = group?.messages[group.messages.length - 1];

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
