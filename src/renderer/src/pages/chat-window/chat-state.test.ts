import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMessage } from "./chat-message-groups.js";
import {
  countFriendMessagesAfter,
  createPendingMessage,
  createReply,
  findFirstFriendMessageAfter,
  getLatestSeq,
  hasGapBefore,
  mergeChatMessages,
  setMessageStatus,
  toChatMessage,
} from "./chat-state.js";

const FRIEND_ID = "friend01";
const MY_ID = "myself01";
const CREATED_AT = "2026-10-05T12:00:00.000Z";

const stored = (seq: number, senderId = FRIEND_ID): ChatMessage =>
  toChatMessage(
    {
      seq,
      senderId,
      body: `message ${seq}`,
      clientNonce: `nonce-${seq}`,
      createdAt: CREATED_AT,
    },
    FRIEND_ID
  );

describe("toChatMessage", () => {
  it("keys messages by nonce and derives the side from the sender", () => {
    assert.deepEqual(stored(3), {
      id: "nonce-3",
      clientNonce: "nonce-3",
      seq: 3,
      fromMe: false,
      text: "message 3",
      createdAt: CREATED_AT,
      status: "sent",
    });
    assert.equal(stored(4, MY_ID).fromMe, true);
  });

  it("keeps reactions and tells whose they are", () => {
    const message = toChatMessage(
      {
        seq: 6,
        senderId: FRIEND_ID,
        body: "gg",
        clientNonce: "nonce-6",
        createdAt: CREATED_AT,
        reactions: [
          { userId: FRIEND_ID, emoji: "😂", updatedAt: CREATED_AT },
          { userId: MY_ID, emoji: "💀", updatedAt: CREATED_AT },
        ],
      },
      FRIEND_ID
    );

    assert.deepEqual(message.reactions, [
      { emoji: "😂", fromMe: false, updatedAt: CREATED_AT },
      { emoji: "💀", fromMe: true, updatedAt: CREATED_AT },
    ]);
    assert.equal(stored(7).reactions, undefined);
  });

  it("keeps the replied-to message, from either side", () => {
    const reply = (senderId: string) =>
      toChatMessage(
        {
          seq: 5,
          senderId: FRIEND_ID,
          body: "sure",
          clientNonce: "nonce-5",
          createdAt: CREATED_AT,
          replyToSeq: 4,
          replyTo: { senderId, body: "lunch?" },
        },
        FRIEND_ID
      ).replyTo;

    assert.deepEqual(reply(MY_ID), {
      seq: 4,
      quoted: { fromMe: true, text: "lunch?" },
    });
    assert.equal(reply(FRIEND_ID)?.quoted?.fromMe, false);
  });

  it("marks replies to messages past retention as unavailable", () => {
    const message = toChatMessage(
      {
        seq: 5,
        senderId: FRIEND_ID,
        body: "sure",
        clientNonce: "nonce-5",
        createdAt: CREATED_AT,
        replyToSeq: 4,
        replyTo: null,
      },
      FRIEND_ID
    );

    assert.deepEqual(message.replyTo, { seq: 4 });
  });
});

describe("createReply", () => {
  it("quotes stored messages by seq", () => {
    assert.deepEqual(createReply(stored(3)), {
      seq: 3,
      quoted: { fromMe: false, text: "message 3" },
    });
  });

  it("refuses messages the server has not stored", () => {
    assert.equal(createReply(createPendingMessage("hi", "nonce-9")), null);
  });

  it("is carried by the optimistic copy of a reply", () => {
    const replyTo = createReply(stored(3));
    const pending = createPendingMessage("ok", "nonce-9", CREATED_AT, replyTo);

    assert.deepEqual(pending.replyTo, replyTo);
    assert.equal(
      "replyTo" in createPendingMessage("ok", "nonce-10", CREATED_AT),
      false
    );
  });
});

describe("mergeChatMessages", () => {
  it("orders stored messages by seq and drops duplicates", () => {
    const merged = mergeChatMessages(
      [stored(1), stored(3)],
      [stored(2), stored(3)]
    );

    assert.deepEqual(
      merged.map((message) => message.seq),
      [1, 2, 3]
    );
  });

  it("keeps known reactions when a message arrives without any", () => {
    const reacted: ChatMessage = {
      ...stored(1),
      reactions: [{ emoji: "🔥", fromMe: true, updatedAt: CREATED_AT }],
    };

    const [fromRealtime] = mergeChatMessages([reacted], [stored(1)]);
    const [fromHistory] = mergeChatMessages(
      [reacted],
      [{ ...stored(1), reactions: [] }]
    );

    assert.deepEqual(fromRealtime.reactions, reacted.reactions);
    assert.deepEqual(fromHistory.reactions, []);
  });

  it("replaces the optimistic copy once the server stores it", () => {
    const pending = createPendingMessage("hi", "nonce-9", CREATED_AT);
    const confirmed = toChatMessage(
      {
        seq: 2,
        senderId: MY_ID,
        body: "hi",
        clientNonce: "nonce-9",
        createdAt: CREATED_AT,
      },
      FRIEND_ID
    );

    const merged = mergeChatMessages([stored(1), pending], [confirmed]);

    assert.deepEqual(
      merged.map(({ id, seq, status }) => ({ id, seq, status })),
      [
        { id: "nonce-1", seq: 1, status: "sent" },
        { id: "nonce-9", seq: 2, status: "sent" },
      ]
    );
  });

  it("keeps unsent messages after stored ones, in writing order", () => {
    const first = createPendingMessage("first", "a", CREATED_AT);
    const second = createPendingMessage("second", "b", CREATED_AT);

    const merged = mergeChatMessages([first, second], [stored(1)]);

    assert.deepEqual(
      merged.map((message) => message.id),
      ["nonce-1", "a", "b"]
    );
  });
});

describe("setMessageStatus", () => {
  it("only changes unsent messages", () => {
    const pending = createPendingMessage("hi", "nonce-9", CREATED_AT);
    const messages = setMessageStatus(
      [stored(1), pending],
      "nonce-9",
      "failed"
    );

    assert.equal(messages[1].status, "failed");
    assert.equal(
      setMessageStatus(messages, "nonce-1", "failed")[0].status,
      "sent"
    );
  });
});

describe("gap detection", () => {
  it("finds the latest stored seq", () => {
    assert.equal(getLatestSeq([]), 0);
    assert.equal(
      getLatestSeq([stored(2), createPendingMessage("x", "x"), stored(5)]),
      5
    );
  });

  it("reports missing messages before an incoming seq", () => {
    assert.equal(hasGapBefore([stored(1), stored(2)], 3), false);
    assert.equal(hasGapBefore([stored(1), stored(2)], 5), true);
    assert.equal(hasGapBefore([], 5), false);
  });
});

describe("countFriendMessagesAfter", () => {
  it("counts only the friend's messages after the given one", () => {
    const messages = [stored(1), stored(2, MY_ID), stored(3), stored(4)];

    assert.equal(countFriendMessagesAfter(messages, messages[0].id), 2);
  });

  it("is zero when nothing came after it", () => {
    const messages = [stored(1), stored(2)];

    assert.equal(countFriendMessagesAfter(messages, messages[1].id), 0);
  });

  it("is zero when the message is no longer in the list", () => {
    assert.equal(countFriendMessagesAfter([stored(1)], "nonce-missing"), 0);
  });
});

describe("findFirstFriendMessageAfter", () => {
  it("skips my own messages", () => {
    const messages = [stored(1), stored(2, MY_ID), stored(3)];

    assert.equal(
      findFirstFriendMessageAfter(messages, messages[0].id),
      messages[2]
    );
  });

  it("is null when the friend sent nothing after it", () => {
    const messages = [stored(1), stored(2, MY_ID)];

    assert.equal(findFirstFriendMessageAfter(messages, messages[0].id), null);
  });
});
