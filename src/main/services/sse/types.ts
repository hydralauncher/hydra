/* Payloads carried by realtime WebSocket envelopes. Field names are part of
   the server contract and must stay camelCase, byte-for-byte. */

export interface FriendRequest {
  invalidate: "friendRequests";
  senderId?: string;
}

export interface FriendGameSession {
  objectId: string;
  shop: string;
  friendId: string;
}

export interface FriendPresence {
  friendId: string;
  isOnline: boolean;
  version: number;
}

export interface Notification {
  invalidate: "notifications";
}

export interface ChatMessageAttachment {
  id: string;
  contentType: "image/jpeg" | "image/png" | "image/gif";
  width: number;
  height: number;
  spoiler: boolean;
  url: string;
}

export interface ChatMessage {
  senderId: string;
  recipientId: string;
  seq: number;
  /* Empty when the message is images only. */
  body: string;
  clientNonce: string;
  createdAt: string;
  replyToSeq?: number;
  replyTo?: {
    senderId: string;
    body: string;
    attachmentCount?: number;
  };
  attachments?: ChatMessageAttachment[];
}

/* Sent only to the sender of a message with images that was not delivered. */
export interface ChatMessageRejected {
  senderId: string;
  recipientId: string;
  clientNonce: string;
  reason: "blocked" | "failed";
}

export interface ChatTyping {
  senderId: string;
}

export interface ChatReaction {
  senderId: string;
  recipientId: string;
  seq: number;
  emoji: string | null;
  updatedAt: string;
}

/* Carried by both chatMessageHidden and chatMessageRestored. */
export interface ChatMessageVisibility {
  senderId: string;
  recipientId: string;
  seq: number;
}
