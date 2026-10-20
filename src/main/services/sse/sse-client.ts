import { UserNotLoggedInError } from "@shared";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { summarizeNetworkError } from "../network-error-summary.js";
import { friendRequestEvent } from "./events/friend-request";
import { friendGameSessionEvent } from "./events/friend-game-session";
import { broadcastFriendsUpdated } from "./friends-updated-broadcast";
import { friendPresenceEvent } from "./events/friend-presence";
import { notificationEvent } from "./events/notification";
import { chatMessageEvent } from "./events/chat-message";
import { chatTypingEvent } from "./events/chat-typing";
import { chatReactionEvent } from "./events/chat-reaction";
import { chatMessageVisibilityEvent } from "./events/chat-message-visibility";
import { chatMessageRejectedEvent } from "./events/chat-message-rejected";
import { resyncAfterEventFailure, resyncAfterReconnect } from "./resync";
import {
  cancelChatCatchUp,
  catchUpChatUnread,
} from "../chat/chat-unread-catch-up";
import {
  RealtimeWebSocketClient,
  type RealtimeEnvelope,
  type RealtimeToken,
} from "./websocket-client";
import type {
  ChatMessage,
  ChatMessageRejected,
  ChatMessageVisibility,
  ChatReaction,
  ChatTyping,
  FriendGameSession,
  FriendPresence,
  FriendRequest,
  Notification,
} from "./types";

const dispatchEvent = async (
  { event, payload }: RealtimeEnvelope,
  signal: AbortSignal
) => {
  switch (event) {
    case "friendRequest":
      await friendRequestEvent(payload satisfies FriendRequest, signal);
      break;
    case "friendGameSession":
      await friendGameSessionEvent(payload satisfies FriendGameSession, signal);
      break;
    case "friendPresence":
      friendPresenceEvent(payload satisfies FriendPresence, signal);
      break;
    case "notification":
      await notificationEvent(payload satisfies Notification, signal);
      break;
    case "chatMessage":
      await chatMessageEvent(payload satisfies ChatMessage, signal);
      break;
    case "chatTyping":
      chatTypingEvent(payload satisfies ChatTyping, signal);
      break;
    case "chatReaction":
      await chatReactionEvent(payload satisfies ChatReaction, signal);
      break;
    case "chatMessageHidden":
      await chatMessageVisibilityEvent(
        payload satisfies ChatMessageVisibility,
        true,
        signal
      );
      break;
    case "chatMessageRestored":
      await chatMessageVisibilityEvent(
        payload satisfies ChatMessageVisibility,
        false,
        signal
      );
      break;
    case "chatMessageRejected":
      await chatMessageRejectedEvent(
        payload satisfies ChatMessageRejected,
        signal
      );
      break;
  }
};

const client = new RealtimeWebSocketClient({
  mintToken: (signal) =>
    HydraApi.post<RealtimeToken>("/auth/realtime", undefined, { signal }),
  onEvent: dispatchEvent,
  onReconnect: (signal) => {
    void resyncAfterReconnect(signal).catch((error) =>
      logger.error(
        "Failed to resync after realtime reconnect",
        summarizeNetworkError(error)
      )
    );
  },
  onEventFailure: (signal) => {
    void resyncAfterEventFailure(signal).catch((error) =>
      logger.error(
        "Failed to resync after realtime event failure",
        summarizeNetworkError(error)
      )
    );
  },
  shouldStop: (error) => {
    if (error instanceof UserNotLoggedInError) {
      logger.info("Realtime connect skipped: user is not logged in");
      return true;
    }
    return false;
  },
  log: logger,
});

// Name retained for callsite and external service compatibility.
export class SSEClient {
  static connect() {
    client.connect();
    // Startup and sign-in: messages sent while the launcher was closed are
    // never pushed, so load and announce them once.
    void catchUpChatUnread();
  }

  static close() {
    client.close();
    // Sign-out and sign-in both close first; a catch-up still running belongs
    // to the previous account.
    cancelChatCatchUp();
    broadcastFriendsUpdated.cancel();
  }

  static reconnectNow() {
    client.reconnectNow();
  }
}
