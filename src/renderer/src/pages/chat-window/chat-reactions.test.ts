import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMessage, ChatReaction } from "./chat-message-groups.js";
import {
  applyReaction,
  getMyReaction,
  toReactionPills,
  updateMessageReactions,
} from "./chat-reactions.js";

const EARLIER = "2026-10-09T12:00:00.000Z";
const LATER = "2026-10-09T12:05:00.000Z";

const mine = (emoji: string, updatedAt = EARLIER): ChatReaction => ({
  emoji,
  fromMe: true,
  updatedAt,
});

const theirs = (emoji: string, updatedAt = EARLIER): ChatReaction => ({
  emoji,
  fromMe: false,
  updatedAt,
});

const message = (seq: number, reactions?: ChatReaction[]): ChatMessage => ({
  id: `nonce-${seq}`,
  clientNonce: `nonce-${seq}`,
  seq,
  fromMe: false,
  text: "hello",
  createdAt: EARLIER,
  status: "sent",
  ...(reactions ? { reactions } : {}),
});

describe("applyReaction", () => {
  it("adds a side's reaction after the other side's", () => {
    assert.deepEqual(
      applyReaction([theirs("😂")], {
        fromMe: true,
        emoji: "🔥",
        updatedAt: LATER,
      }),
      [theirs("😂"), mine("🔥", LATER)]
    );
  });

  it("replaces the side's earlier reaction, keeping one per side", () => {
    assert.deepEqual(
      applyReaction([mine("👍"), theirs("😂")], {
        fromMe: true,
        emoji: "🔥",
        updatedAt: LATER,
      }),
      [theirs("😂"), mine("🔥", LATER)]
    );
  });

  it("removes the side's reaction for a null emoji", () => {
    assert.deepEqual(
      applyReaction([mine("👍"), theirs("😂")], {
        fromMe: false,
        emoji: null,
        updatedAt: LATER,
      }),
      [mine("👍")]
    );
  });

  it("drops changes older than the side's current reaction", () => {
    const reactions = [theirs("😂", LATER)];

    assert.equal(
      applyReaction(reactions, {
        fromMe: false,
        emoji: null,
        updatedAt: EARLIER,
      }),
      reactions
    );
  });

  it("lets any server change replace an unsaved reaction", () => {
    assert.deepEqual(
      applyReaction([{ ...mine("🔥", LATER), isPending: true }], {
        fromMe: true,
        emoji: "🔥",
        updatedAt: EARLIER,
      }),
      [mine("🔥")]
    );
  });

  it("marks optimistic reactions as pending", () => {
    assert.deepEqual(
      applyReaction([], {
        fromMe: true,
        emoji: "🔥",
        updatedAt: LATER,
        isPending: true,
      }),
      [{ ...mine("🔥", LATER), isPending: true }]
    );
  });
});

describe("updateMessageReactions", () => {
  it("changes only the message with the seq", () => {
    const messages = [message(1), message(2, [theirs("😂")])];

    const updated = updateMessageReactions(messages, 1, (reactions) => [
      ...reactions,
      mine("🔥"),
    ]);

    assert.deepEqual(updated[0].reactions, [mine("🔥")]);
    assert.equal(updated[1], messages[1]);
  });
});

describe("toReactionPills", () => {
  it("merges the same emoji from both sides into one pill", () => {
    assert.deepEqual(toReactionPills([theirs("😂"), mine("😂", LATER)]), [
      { emoji: "😂", fromMe: true, fromFriend: true, isPending: false },
    ]);
  });

  it("keeps different emoji apart, in the order first used", () => {
    assert.deepEqual(
      toReactionPills([
        theirs("😂"),
        { ...mine("💀", LATER), isPending: true },
      ]),
      [
        { emoji: "😂", fromMe: false, fromFriend: true, isPending: false },
        { emoji: "💀", fromMe: true, fromFriend: false, isPending: true },
      ]
    );
  });
});

describe("getMyReaction", () => {
  it("finds the user's own emoji", () => {
    assert.equal(getMyReaction(message(1, [theirs("😂"), mine("🔥")])), "🔥");
    assert.equal(getMyReaction(message(1, [theirs("😂")])), null);
    assert.equal(getMyReaction(message(1)), null);
  });
});
