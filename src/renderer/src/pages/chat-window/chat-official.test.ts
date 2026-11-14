import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OfficialMessagesPage, UserFriend } from "@types";

import {
  applyOfficialPage,
  isOfficialMessagesPage,
  toChatMessagesPage,
  toOfficialFriend,
} from "./chat-official.js";
import type { ChatConversation } from "./chat-types";

const SENDER = {
  id: "HYDRAOFC",
  displayName: "Hydra",
  profileImageUrl: null,
  isOfficial: true,
} as const;

const dto = (seq: number) => ({
  id: `message-${seq}`,
  seq,
  senderId: SENDER.id,
  body: `Message ${seq}`,
  locale: "en",
  attachments: [],
  createdAt: new Date(seq * 1000).toISOString(),
  isUnread: false,
});

const page = (
  seqs: number[],
  overrides: Partial<OfficialMessagesPage> = {}
): OfficialMessagesPage => ({
  sender: SENDER,
  messages: seqs.map(dto),
  unreadCount: 0,
  hasMoreBefore: false,
  nextPollSeconds: 1800,
  ...overrides,
});

const createConversation = (friend: UserFriend): ChatConversation => ({
  friend,
  messages: [],
  isTyping: false,
  unreadCount: 0,
  draft: "",
  draftImages: [],
  replyToSeq: null,
  canSend: true,
  loadState: "idle",
  hasMoreBefore: false,
  isLoadingOlder: false,
  gapAfterSeq: null,
});

const otherConversation = createConversation({
  id: "friend01",
  displayName: "Friend",
  profileImageUrl: null,
  backgroundImageUrl: null,
  currentGame: null,
  isOnline: false,
} as UserFriend);

describe("isOfficialMessagesPage", () => {
  it("accepts a real page", () => {
    assert.equal(isOfficialMessagesPage(page([1])), true);
  });

  it("rejects an error body in place of a page", () => {
    assert.equal(
      isOfficialMessagesPage({ title: "Error 1200: rate limited" }),
      false
    );
    assert.equal(isOfficialMessagesPage(null), false);
    assert.equal(isOfficialMessagesPage("<html></html>"), false);
  });
});

describe("toOfficialFriend", () => {
  it("falls back to the bundled logo", () => {
    const friend = toOfficialFriend(SENDER);
    assert.equal(friend.isOfficial, true);
    assert.match(friend.profileImageUrl ?? "", /^data:image\/svg\+xml/);
  });
});

describe("toChatMessagesPage", () => {
  it("uses the message id as the client nonce and never allows sending", () => {
    const result = toChatMessagesPage(page([1, 2], { hasMoreBefore: true }));
    assert.equal(result.messages[0]?.clientNonce, "message-1");
    assert.equal(result.canSend, false);
    assert.equal(result.hasMore, true);
  });

  it("keeps only messages after a seq", () => {
    const result = toChatMessagesPage(
      page([1, 2, 3], { hasMoreBefore: true }),
      2
    );
    assert.deepEqual(
      result.messages.map(({ seq }) => seq),
      [3]
    );
    assert.equal(result.hasMore, false);
  });
});

describe("applyOfficialPage", () => {
  it("adds the conversation as loaded, so no history request goes out", () => {
    const [official, other] = applyOfficialPage(
      [otherConversation],
      page([1, 7], { unreadCount: 2 }),
      createConversation
    );

    assert.equal(official?.friend.id, SENDER.id);
    assert.equal(official?.friend.isOfficial, true);
    assert.equal(official?.loadState, "loaded");
    assert.equal(official?.canSend, false);
    assert.equal(official?.unreadCount, 2);
    assert.equal(official?.gapAfterSeq, null);
    assert.equal(other?.friend.id, "friend01");
  });

  it("shows the sender's messages as received", () => {
    const [official] = applyOfficialPage([], page([1]), createConversation);
    assert.equal(official?.messages[0]?.fromMe, false);
  });

  it("removes the row once nothing is visible", () => {
    const withOfficial = applyOfficialPage(
      [otherConversation],
      page([1]),
      createConversation
    );
    const result = applyOfficialPage(
      withOfficial,
      page([]),
      createConversation
    );
    assert.deepEqual(
      result.map(({ friend }) => friend.id),
      ["friend01"]
    );
  });

  it("replaces the history with the latest page, dropping retracted messages", () => {
    const loaded = applyOfficialPage(
      [],
      page([1, 2, 3, 4], { hasMoreBefore: false }),
      createConversation
    );
    const [official] = applyOfficialPage(
      loaded,
      page([3, 5], { hasMoreBefore: true }),
      createConversation
    );

    assert.deepEqual(
      official?.messages.map(({ seq }) => seq),
      [3, 5]
    );
    assert.equal(official?.hasMoreBefore, true);
  });
});
