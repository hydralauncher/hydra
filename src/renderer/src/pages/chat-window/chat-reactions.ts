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

const isNewer = (a: ChatReaction, b: ChatReaction) =>
  Date.parse(a.updatedAt) > Date.parse(b.updatedAt);

const byUpdatedAt = (a: ChatReaction, b: ChatReaction) =>
  Date.parse(a.updatedAt) - Date.parse(b.updatedAt);

/** A removal that keeps the time of the side's last known change. */
const toRemoval = (reaction: ChatReaction): ChatReaction => ({
  emoji: null,
  fromMe: reaction.fromMe,
  updatedAt: reaction.updatedAt,
});

/**
 * Applies a reaction change for one side. Realtime events can arrive out of
 * order, so a change older than the side's current one is dropped, unless
 * either is an optimistic, unsaved reaction: the user's own pick always shows,
 * whatever the clocks say. Removals stay in the list, so an older change
 * can't bring a removed reaction back.
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
    !update.isPending &&
    Date.parse(update.updatedAt) < Date.parse(current.updatedAt)
  ) {
    return reactions;
  }

  const others = reactions.filter(
    (reaction) => reaction.fromMe !== update.fromMe
  );

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

const mergeSide = (
  current: ChatReaction | undefined,
  saved: ChatReaction | undefined,
  keepMissing: boolean
) => {
  if (current?.isPending) return current;
  if (!saved) return current && !keepMissing ? toRemoval(current) : current;
  return current && isNewer(current, saved) ? current : saved;
};

/**
 * Merges the reactions a server response reported for a message into the
 * known ones. Each side keeps whichever change is newer, so a slow response
 * can't undo a realtime event, and an unsaved reaction stays until its own
 * request settles. A side the response leaves out has no reaction.
 *
 * With `settleMine`, the response is the result of the user's latest change:
 * their side is taken from it as is, and a friend's reaction it leaves out is
 * kept, since it may have come in by realtime while the request ran.
 */
export const mergeReactions = (
  known: ChatReaction[],
  stored: ChatReaction[],
  { settleMine = false } = {}
): ChatReaction[] => {
  const sideOf = (reactions: ChatReaction[], fromMe: boolean) =>
    reactions.find((reaction) => reaction.fromMe === fromMe);

  const current = sideOf(known, true);
  const saved = sideOf(stored, true);
  const fallback = current ? toRemoval(current) : undefined;
  const mine = settleMine
    ? (saved ?? fallback)
    : mergeSide(current, saved, false);
  const friend = mergeSide(
    sideOf(known, false),
    sideOf(stored, false),
    settleMine
  );

  return [mine, friend]
    .filter((reaction): reaction is ChatReaction => reaction !== undefined)
    .sort(byUpdatedAt);
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
    if (reaction.emoji === null) continue;

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
