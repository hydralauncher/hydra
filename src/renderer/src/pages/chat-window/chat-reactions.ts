import type { ChatMessage, ChatReaction } from "./chat-message-groups";

export interface ChatReactionUpdate {
  fromMe: boolean;
  /** Null removes the side's reaction. */
  emoji: string | null;
  updatedAt: string;
  isPending?: boolean;
}

/** One pill under a message: an emoji and who reacted with it. */
export interface ChatReactionPill {
  emoji: string;
  fromMe: boolean;
  fromFriend: boolean;
  isPending: boolean;
}

/**
 * Applies a reaction change for one side. Realtime events can arrive out of
 * order, so a change older than the side's current reaction is dropped,
 * unless that reaction is still an optimistic, unsaved one.
 */
export const applyReaction = (
  reactions: ChatReaction[],
  update: ChatReactionUpdate
): ChatReaction[] => {
  const current = reactions.find(
    (reaction) => reaction.fromMe === update.fromMe
  );
  if (
    current &&
    !current.isPending &&
    Date.parse(update.updatedAt) < Date.parse(current.updatedAt)
  ) {
    return reactions;
  }

  const others = reactions.filter(
    (reaction) => reaction.fromMe !== update.fromMe
  );
  if (update.emoji === null) return others;

  return [
    ...others,
    {
      emoji: update.emoji,
      fromMe: update.fromMe,
      updatedAt: update.updatedAt,
      ...(update.isPending ? { isPending: true } : {}),
    },
  ];
};

export const updateMessageReactions = (
  messages: ChatMessage[],
  seq: number,
  update: (reactions: ChatReaction[]) => ChatReaction[]
) =>
  messages.map((message) =>
    message.seq === seq
      ? { ...message, reactions: update(message.reactions ?? []) }
      : message
  );

/** Same emoji from both sides share one pill, in the order first used. */
export const toReactionPills = (
  reactions: ChatReaction[]
): ChatReactionPill[] => {
  const pills: ChatReactionPill[] = [];

  for (const reaction of reactions) {
    const pill = pills.find((current) => current.emoji === reaction.emoji);
    if (pill) {
      pill.fromMe ||= reaction.fromMe;
      pill.fromFriend ||= !reaction.fromMe;
      pill.isPending ||= Boolean(reaction.isPending);
    } else {
      pills.push({
        emoji: reaction.emoji,
        fromMe: reaction.fromMe,
        fromFriend: !reaction.fromMe,
        isPending: Boolean(reaction.isPending),
      });
    }
  }

  return pills;
};

export const getMyReaction = (message: ChatMessage) =>
  message.reactions?.find((reaction) => reaction.fromMe)?.emoji ?? null;
