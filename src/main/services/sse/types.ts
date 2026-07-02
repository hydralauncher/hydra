/* Wire payloads for the `/realtime/events` SSE stream. Field names are part of
   the server contract and must stay camelCase, byte-for-byte. */

export interface Connected {
  heartbeatIntervalSeconds: number;
}

export interface FriendRequest {
  friendRequestCount: number;
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
}

export interface Notification {
  notificationCount: number;
}
