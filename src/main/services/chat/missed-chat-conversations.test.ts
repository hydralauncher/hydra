import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getMissedChatConversations,
  type UnreadChatConversation,
} from "./missed-chat-conversations.ts";

const conversation = (
  friendId: string,
  unreadCount: number,
  lastMessageAt: string
): UnreadChatConversation => ({ friendId, unreadCount, lastMessageAt });

const nothingOpen = () => false;

describe("getMissedChatConversations", () => {
  const alice = conversation("alice001", 2, "2026-10-05T12:00:00.000Z");
  const bob = conversation("bob00001", 3, "2026-10-05T13:00:00.000Z");

  it("announces every unread conversation when nothing was announced yet", () => {
    const missed = getMissedChatConversations([alice, bob], null, nothingOpen);

    assert.deepEqual(
      missed.conversations.map(({ friendId }) => friendId),
      ["alice001", "bob00001"]
    );
    assert.equal(missed.messageCount, 5);
    assert.equal(missed.latestMessageAt, bob.lastMessageAt);
  });

  it("skips conversations already announced", () => {
    const missed = getMissedChatConversations(
      [alice, bob],
      "2026-10-05T12:30:00.000Z",
      nothingOpen
    );

    assert.deepEqual(
      missed.conversations.map(({ friendId }) => friendId),
      ["bob00001"]
    );
  });

  it("returns nothing when the newest message was already announced", () => {
    const missed = getMissedChatConversations(
      [alice, bob],
      bob.lastMessageAt,
      nothingOpen
    );

    assert.equal(missed.conversations.length, 0);
    assert.equal(missed.messageCount, 0);
    assert.equal(missed.latestMessageAt, "");
  });

  it("skips conversations open in a focused chat window", () => {
    const missed = getMissedChatConversations(
      [alice, bob],
      null,
      (friendId) => friendId === "bob00001"
    );

    assert.deepEqual(
      missed.conversations.map(({ friendId }) => friendId),
      ["alice001"]
    );
  });
});
