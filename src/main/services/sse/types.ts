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
}

export interface ChatTyping {
  senderId: string;
}
