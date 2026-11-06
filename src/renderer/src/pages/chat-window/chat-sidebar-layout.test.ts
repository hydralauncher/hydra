import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_SIDEBAR_INITIAL_WIDTH,
  CHAT_SIDEBAR_MAX_WIDTH,
  CHAT_SIDEBAR_MIN_WIDTH,
  clampChatSidebarWidth,
  dropAbandonedConversations,
  filterConversations,
  getAdjacentConversationId,
  getConversationPreview,
  getLatestMessage,
  isOfficialAccount,
  sortConversationsByActivity,
  toConversationLastMessage,
} from "./chat-sidebar-layout.js";

const conversation = (displayName: string) => ({ friend: { displayName } });

describe("clampChatSidebarWidth", () => {
  it("keeps the width inside the main sidebar's limits", () => {
    assert.equal(clampChatSidebarWidth(100), CHAT_SIDEBAR_MIN_WIDTH);
    assert.equal(clampChatSidebarWidth(900), CHAT_SIDEBAR_MAX_WIDTH);
    assert.equal(clampChatSidebarWidth(300), 300);
  });

  it("leaves room for the conversation in a narrow window", () => {
    assert.equal(clampChatSidebarWidth(450, 560), 360);
    assert.equal(clampChatSidebarWidth(450, 400), CHAT_SIDEBAR_MIN_WIDTH);
    assert.equal(clampChatSidebarWidth(250, 560), 250);
  });

  it("rounds fractional widths and falls back from garbage", () => {
    assert.equal(clampChatSidebarWidth(300.6), 301);
    assert.equal(clampChatSidebarWidth(Number.NaN), CHAT_SIDEBAR_INITIAL_WIDTH);
  });
});

describe("filterConversations", () => {
  const conversations = [
    conversation("Marina"),
    conversation("Lúcia"),
    conversation("Amanda"),
  ];

  it("returns everything for a blank query", () => {
    assert.equal(filterConversations(conversations, "  "), conversations);
  });

  it("matches anywhere in the name, ignoring case, keeping the order", () => {
    assert.deepEqual(
      filterConversations(conversations, "MA").map((c) => c.friend.displayName),
      ["Marina", "Amanda"]
    );
  });
});

describe("getAdjacentConversationId", () => {
  const ids = ["a", "b", "c"];

  it("wraps around both ends", () => {
    assert.equal(getAdjacentConversationId(ids, "c", 1), "a");
    assert.equal(getAdjacentConversationId(ids, "a", -1), "c");
  });

  it("starts from an end when nothing is active", () => {
    assert.equal(getAdjacentConversationId(ids, null, 1), "a");
    assert.equal(getAdjacentConversationId(ids, null, -1), "c");
  });

  it("has nowhere to go with a single conversation", () => {
    assert.equal(getAdjacentConversationId(["a"], "a", 1), null);
  });
});

describe("getConversationPreview", () => {
  const message = (
    overrides: Partial<{
      text: string;
      fromMe: boolean;
      isHidden: boolean;
      attachments: { id: string }[];
    }>
  ) => ({
    id: "1",
    clientNonce: "1",
    fromMe: false,
    text: "",
    createdAt: "2026-01-01T00:00:00Z",
    status: "sent" as const,
    ...overrides,
  });

  it("is empty without messages", () => {
    assert.equal(getConversationPreview({ messages: [] }), null);
  });

  it("collapses whitespace in the latest message", () => {
    assert.deepEqual(
      getConversationPreview({
        messages: [
          message({ text: "first" }),
          message({ text: "  gg,\n\nrematch? ", fromMe: true }),
        ],
      } as never),
      { kind: "text", text: "gg, rematch?", fromMe: true }
    );
  });

  it("describes image-only and removed messages", () => {
    assert.deepEqual(
      getConversationPreview({
        messages: [message({ attachments: [{ id: "a" }, { id: "b" }] })],
      } as never),
      { kind: "images", count: 2, fromMe: false }
    );
    assert.deepEqual(
      getConversationPreview({
        messages: [message({ text: "x", isHidden: true })],
      } as never),
      { kind: "removed" }
    );
  });
});

describe("getLatestMessage", () => {
  const listed = {
    seq: 5,
    fromMe: false,
    text: "listed",
    createdAt: "2026-01-02T00:00:00Z",
    isHidden: false,
    attachmentCount: 0,
  };
  const message = (seq: number | undefined, text: string) => ({
    id: text,
    clientNonce: text,
    seq,
    fromMe: true,
    text,
    createdAt: "2026-01-03T00:00:00Z",
    status: "sent" as const,
  });

  it("uses the list's message until history loads", () => {
    assert.equal(
      getLatestMessage({ messages: [], lastMessage: listed }),
      listed
    );
  });

  it("prefers loaded history once it is newer", () => {
    assert.equal(
      getLatestMessage({ messages: [message(4, "old")], lastMessage: listed }),
      listed
    );
    assert.equal(
      getLatestMessage({ messages: [message(6, "new")], lastMessage: listed })
        ?.text,
      "new"
    );
  });

  it("treats a pending message as the newest", () => {
    assert.equal(
      getLatestMessage({
        messages: [message(undefined, "pending")],
        lastMessage: listed,
      })?.text,
      "pending"
    );
  });
});

describe("toConversationLastMessage", () => {
  it("tells the sides apart by sender", () => {
    const dto = {
      friendId: "friend",
      friend: { id: "friend", displayName: "F", profileImageUrl: null },
      lastMessage: {
        seq: 3,
        senderId: "me",
        body: "hi",
        hidden: false,
        attachmentCount: 2,
        createdAt: "2026-01-01T00:00:00Z",
      },
      lastMessageAt: "2026-01-01T00:00:00Z",
      lastReadSeq: 3,
      unreadCount: 0,
      canSend: true,
    };

    assert.deepEqual(toConversationLastMessage(dto), {
      seq: 3,
      fromMe: true,
      text: "hi",
      createdAt: "2026-01-01T00:00:00Z",
      isHidden: false,
      attachmentCount: 2,
    });
  });
});

describe("sortConversationsByActivity", () => {
  const at = (createdAt: string) => ({
    seq: 1,
    fromMe: true,
    text: "x",
    createdAt,
    isHidden: false,
    attachmentCount: 0,
  });

  const friend = {};

  it("puts the latest message first, keeping ties in place", () => {
    const old = {
      id: "old",
      friend,
      messages: [],
      lastMessage: at("2026-01-01T00:00:00Z"),
    };
    const newer = {
      id: "newer",
      friend,
      messages: [],
      lastMessage: at("2026-01-03T00:00:00Z"),
    };
    const same = {
      id: "same",
      friend,
      messages: [],
      lastMessage: at("2026-01-01T00:00:00Z"),
    };

    assert.deepEqual(
      sortConversationsByActivity([old, newer, same]).map((c) => c.id),
      ["newer", "old", "same"]
    );
  });

  it("keeps a conversation without messages at the top", () => {
    const empty = { id: "empty", friend, messages: [] };
    const chatted = {
      id: "chatted",
      friend,
      messages: [],
      lastMessage: at("2026-01-03T00:00:00Z"),
    };

    assert.deepEqual(
      sortConversationsByActivity([chatted, empty]).map((c) => c.id),
      ["empty", "chatted"]
    );
  });

  it("pins the official conversation above everything, even a new one", () => {
    const empty = { id: "empty", friend, messages: [] };
    const chatted = {
      id: "chatted",
      friend,
      messages: [],
      lastMessage: at("2026-01-03T00:00:00Z"),
    };
    const official = {
      id: "official",
      friend: { isOfficial: true },
      messages: [],
      lastMessage: at("2026-01-01T00:00:00Z"),
    };

    assert.deepEqual(
      sortConversationsByActivity([chatted, official, empty]).map((c) => c.id),
      ["official", "empty", "chatted"]
    );
  });
});

describe("isOfficialAccount", () => {
  it("is only the account the API marks", () => {
    assert.equal(isOfficialAccount({ isOfficial: true }), true);
    assert.equal(isOfficialAccount({ isOfficial: false }), false);
    assert.equal(isOfficialAccount({}), false);
  });
});

describe("dropAbandonedConversations", () => {
  const empty = (id: string) => ({
    friend: { id },
    messages: [],
    lastMessage: undefined,
    draft: "",
    draftImages: [],
    unreadCount: 0,
  });

  it("drops empty conversations that are no longer active", () => {
    const result = dropAbandonedConversations(
      [empty("a"), empty("b"), { ...empty("c"), draft: "hey" }],
      "b"
    );
    assert.deepEqual(
      result.map(({ friend }) => friend.id),
      ["b", "c"]
    );
  });

  it("keeps conversations whose images are still preparing", () => {
    const result = dropAbandonedConversations(
      [empty("a"), empty("b")],
      "b",
      new Set(["a"])
    );
    assert.deepEqual(
      result.map(({ friend }) => friend.id),
      ["a", "b"]
    );
  });

  it("keeps listed, unread and active conversations", () => {
    const listed = {
      ...empty("a"),
      lastMessage: {
        seq: 1,
        fromMe: false,
        text: "hi",
        createdAt: "",
        isHidden: false,
        attachmentCount: 0,
      },
    };
    const unread = { ...empty("b"), unreadCount: 1 };
    const conversations = [listed, unread, empty("c")];
    assert.equal(dropAbandonedConversations(conversations, "c"), conversations);
  });
});
