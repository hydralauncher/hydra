import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMessage, ChatReaction } from "./chat-message-groups.js";
import {
  applyReaction,
  getMyReaction,
  mergeReactions,
  toReactionPills,
  updateMessageReactions,
} from "./chat-reactions.js";

const EARLIER = "2026-10-09T12:00:00.000Z";
const LATER = "2026-10-09T12:05:00.000Z";
const LATEST = "2026-10-09T12:10:00.000Z";

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

  it("records a removal for a null emoji", () => {
    assert.deepEqual(
      applyReaction([mine("👍"), theirs("😂")], {
        fromMe: false,
        emoji: null,
        updatedAt: LATER,
      }),
      [mine("👍"), { emoji: null, fromMe: false, updatedAt: LATER }]
    );
  });

  it("keeps an older change from bringing a removed reaction back", () => {
    const reactions: ChatReaction[] = [
      { emoji: null, fromMe: false, updatedAt: LATER },
    ];

    assert.equal(
      applyReaction(reactions, {
        fromMe: false,
        emoji: "😂",
        updatedAt: EARLIER,
      }),
      reactions
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

describe("mergeReactions", () => {
  it("keeps whichever change is newer on each side", () => {
    assert.deepEqual(
      mergeReactions(
        [theirs("🔥", LATER), mine("👍")],
        [theirs("😂"), mine("💀", LATEST)]
      ),
      [theirs("🔥", LATER), mine("💀", LATEST)]
    );
  });

  it("records a removal for a side the response leaves out", () => {
    assert.deepEqual(mergeReactions([theirs("😂")], []), [
      { emoji: null, fromMe: false, updatedAt: EARLIER },
    ]);
  });

  it("keeps an unsaved reaction until its request settles", () => {
    const pending = { ...mine("🔥", LATER), isPending: true };

    assert.deepEqual(mergeReactions([pending], [mine("👍")]), [pending]);
  });

  it("settles the user's side with the request's result, keeping the friend's", () => {
    const pending = { ...mine("🔥", LATER), isPending: true };

    assert.deepEqual(
      mergeReactions([pending, theirs("😂", LATER)], [mine("👍")], {
        settleMine: true,
      }),
      [mine("👍"), theirs("😂", LATER)]
    );
    assert.deepEqual(mergeReactions([pending], [], { settleMine: true }), [
      { emoji: null, fromMe: true, updatedAt: LATER },
    ]);
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
  it("leaves out removed reactions", () => {
    assert.deepEqual(
      toReactionPills([{ emoji: null, fromMe: false, updatedAt: EARLIER }]),
      []
    );
  });

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
