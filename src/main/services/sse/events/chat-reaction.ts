import type { ChatReactionSync, User } from "@types";
import { db, levelKeys } from "@main/level";
import { WindowManager } from "@main/services/window-manager";
import type { ChatReaction } from "../types";

export const chatReactionEvent = async (
  payload: ChatReaction,
  signal: AbortSignal
) => {
  if (signal.aborted) return;

  const user = await db
    .get<string, User | null>(levelKeys.user, { valueEncoding: "json" })
    .catch(() => null);
  if (!user?.id || signal.aborted) return;

  const fromMe = payload.senderId === user.id;

  WindowManager.sendToChatWindow("on-chat-reaction", {
    friendId: fromMe ? payload.recipientId : payload.senderId,
    seq: payload.seq,
    fromMe,
    emoji: payload.emoji,
    updatedAt: payload.updatedAt,
  } satisfies ChatReactionSync);
};
