import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMessage } from "./chat-message-groups.js";
import {
  createPendingMessage,
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
