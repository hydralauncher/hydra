import type { ChatTypingSync } from "@types";
import { WindowManager } from "@main/services/window-manager";
import type { ChatTyping } from "../types";

export const chatTypingEvent = (payload: ChatTyping, signal: AbortSignal) => {
  if (signal.aborted) return;
  WindowManager.sendToChatWindow("on-chat-typing", {
    friendId: payload.senderId,
  } satisfies ChatTypingSync);
};
