import type { UserFriend } from "@types";

import type { ChatDraftImage } from "./chat-attachments";
import type { ChatMessage } from "./chat-message-groups";

export type ChatLoadState = "idle" | "loading" | "loaded" | "error";

/** The latest message as the conversation list reported it. */
export interface ChatConversationLastMessage {
  seq: number;
  fromMe: boolean;
  /** Empty when hidden, or images only. */
  text: string;
  createdAt: string;
  isHidden: boolean;
  attachmentCount: number;
}

export interface ChatConversation {
  friend: UserFriend;
  messages: ChatMessage[];
  /**
   * Stands in for `messages` in the sidebar until history loads; `messages`
   * wins once it holds something newer.
   */
  lastMessage?: ChatConversationLastMessage;
  isTyping: boolean;
  unreadCount: number;
  draft: string;
  /** Images in the composer, sent with the draft. */
  draftImages: ChatDraftImage[];
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
