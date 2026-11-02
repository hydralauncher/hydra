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
    const missed = getMissedChatConversations([alice, bob], {}, nothingOpen);

    assert.deepEqual(
      missed.conversations.map(({ friendId }) => friendId),
      ["alice001", "bob00001"]
    );
    assert.equal(missed.messageCount, 5);
  });

  it("skips conversations already announced", () => {
    const missed = getMissedChatConversations(
      [alice, bob],
      { alice001: alice.lastMessageAt },
      nothingOpen
    );

    assert.deepEqual(
      missed.conversations.map(({ friendId }) => friendId),
      ["bob00001"]
    );
  });

  it("returns nothing when every conversation was already announced", () => {
    const missed = getMissedChatConversations(
      [alice, bob],
      { alice001: alice.lastMessageAt, bob00001: bob.lastMessageAt },
      nothingOpen
    );

    assert.equal(missed.conversations.length, 0);
    assert.equal(missed.messageCount, 0);
  });

  it("announces older messages when another conversation was announced later", () => {
    // A live message from Bob must not hide what Alice sent while offline.
    const missed = getMissedChatConversations(
      [alice, bob],
      { bob00001: bob.lastMessageAt },
      nothingOpen
    );

    assert.deepEqual(
      missed.conversations.map(({ friendId }) => friendId),
      ["alice001"]
    );
  });

  it("announces a conversation again once a newer message arrives", () => {
    const missed = getMissedChatConversations(
      [alice],
      { alice001: "2026-10-05T11:00:00.000Z" },
      nothingOpen
    );

    assert.deepEqual(
      missed.conversations.map(({ friendId }) => friendId),
      ["alice001"]
    );
  });

  it("skips conversations open in a focused chat window", () => {
    const missed = getMissedChatConversations(
      [alice, bob],
      {},
      (friendId) => friendId === "bob00001"
    );

    assert.deepEqual(
      missed.conversations.map(({ friendId }) => friendId),
      ["alice001"]
    );
  });
});
