import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  shouldNotifyChatMessage,
  type ChatMessageNotificationContext,
} from "./should-notify-chat-message.ts";

const context = (
  overrides: Partial<ChatMessageNotificationContext> = {}
): ChatMessageNotificationContext => ({
  notificationsEnabled: true,
  fromMe: false,
  isNewMessage: true,
  isOpenInFocusedChatWindow: false,
  ...overrides,
});

describe("shouldNotifyChatMessage", () => {
  it("notifies new messages from a friend the user cannot see", () => {
    assert.equal(shouldNotifyChatMessage(context()), true);
  });

  it("stays quiet when the conversation is already open in a focused chat window", () => {
    assert.equal(
      shouldNotifyChatMessage(context({ isOpenInFocusedChatWindow: true })),
      false
    );
  });

  it("respects the notification preference", () => {
    assert.equal(
      shouldNotifyChatMessage(context({ notificationsEnabled: false })),
      false
    );
  });

  it("never notifies the user's own messages or duplicate deliveries", () => {
    assert.equal(shouldNotifyChatMessage(context({ fromMe: true })), false);
    assert.equal(
      shouldNotifyChatMessage(context({ isNewMessage: false })),
      false
    );
  });
});
