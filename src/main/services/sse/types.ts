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

export interface ChatMessage {
  senderId: string;
  recipientId: string;
  seq: number;
  body: string;
  clientNonce: string;
  createdAt: string;
  replyToSeq?: number;
  replyTo?: {
    senderId: string;
    body: string;
  };
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
