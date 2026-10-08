import type { UserFriend } from "@types";

import type { ChatMessage } from "./chat-message-groups";

export type ChatLoadState = "idle" | "loading" | "loaded" | "error";

export interface ChatConversation {
  friend: UserFriend;
  messages: ChatMessage[];
  isTyping: boolean;
  unreadCount: number;
  draft: string;
  /** False after an unfriend or block: history stays readable, sending stops. */
  canSend: boolean;
  loadState: ChatLoadState;
  hasMoreBefore: boolean;
  isLoadingOlder: boolean;
}
