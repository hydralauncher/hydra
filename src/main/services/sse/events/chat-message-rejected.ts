import type { ChatMessageRejectedSync, User } from "@types";
import { db, levelKeys } from "@main/level";
import { WindowManager } from "@main/services/window-manager";
import type { ChatMessageRejected } from "../types";

export const chatMessageRejectedEvent = async (
  payload: ChatMessageRejected,
  signal: AbortSignal
) => {
  if (signal.aborted) return;

  const user = await db
    .get<string, User | null>(levelKeys.user, { valueEncoding: "json" })
    .catch(() => null);
  if (!user?.id || signal.aborted || payload.senderId !== user.id) return;

  WindowManager.sendToChatWindow("on-chat-message-rejected", {
    friendId: payload.recipientId,
    clientNonce: payload.clientNonce,
    reason: payload.reason,
  } satisfies ChatMessageRejectedSync);
};
