import type { ChatMessageVisibilitySync, User } from "@types";
import { db, levelKeys } from "@main/level";
import { WindowManager } from "@main/services/window-manager";
import type { ChatMessageVisibility } from "../types";

export const chatMessageVisibilityEvent = async (
  payload: ChatMessageVisibility,
  hidden: boolean,
  signal: AbortSignal
) => {
  if (signal.aborted) return;

  const user = await db
    .get<string, User | null>(levelKeys.user, { valueEncoding: "json" })
    .catch(() => null);
  if (!user?.id || signal.aborted) return;

  const fromMe = payload.senderId === user.id;

  WindowManager.sendToChatWindow("on-chat-message-visibility", {
    friendId: fromMe ? payload.recipientId : payload.senderId,
    seq: payload.seq,
    hidden,
  } satisfies ChatMessageVisibilitySync);
};
