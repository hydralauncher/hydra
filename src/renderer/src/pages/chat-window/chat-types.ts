import type { UserFriend } from "@types";

import type { ChatMessage } from "./chat-message-groups";

export type ChatLoadState = "idle" | "loading" | "loaded" | "error";

export interface ChatConversation {
  friend: UserFriend;
  messages: ChatMessage[];
  isTyping: boolean;
  unreadCount: number;
  draft: string;
  /** Seq of the message the next send replies to. */
  replyToSeq: number | null;
  /** False after an unfriend or block: history stays readable, sending stops. */
  canSend: boolean;
  loadState: ChatLoadState;
  hasMoreBefore: boolean;
  isLoadingOlder: boolean;
  /**
   * Seq of the last message before ones that were missed, until they are
   * loaded. Messages past it are not marked read meanwhile.
   */
  gapAfterSeq: number | null;
}
