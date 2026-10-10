import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMOJI_CATEGORIES,
  MAX_RECENT_EMOJI,
  QUICK_REACTIONS,
  addRecentEmoji,
  countEmojiOnly,
  findEmoji,
  searchEmoji,
} from "./chat-emoji.js";

describe("countEmojiOnly", () => {
  it("counts messages made only of emoji", () => {
    assert.equal(countEmojiOnly("🔥"), 1);
    assert.equal(countEmojiOnly("😂😂😂"), 3);
    assert.equal(countEmojiOnly("🎮 🕹️ 👾 🏆 🎉"), 5);
    assert.equal(countEmojiOnly(" ❤️\n"), 1);
  });

  it("counts each multi-codepoint emoji once", () => {
    assert.equal(countEmojiOnly("👍🏽"), 1);
    assert.equal(countEmojiOnly("🇧🇷"), 1);
    assert.equal(countEmojiOnly("1️⃣"), 1);
    assert.equal(countEmojiOnly("👨‍👩‍👧‍👦"), 1);
    assert.equal(countEmojiOnly("❤️‍🔥🏳️‍⚧️"), 2);
  });

  it("is zero for any text alongside the emoji", () => {
    assert.equal(countEmojiOnly("gg 🔥"), 0);
    assert.equal(countEmojiOnly("🔥!"), 0);
    assert.equal(countEmojiOnly("1"), 0);
    assert.equal(countEmojiOnly(""), 0);
    assert.equal(countEmojiOnly("   "), 0);
  });
});

describe("emoji data", () => {
  it("lists every emoji once and only real emoji", () => {
    const emoji = EMOJI_CATEGORIES.flatMap((category) =>
      category.items.map((item) => item.emoji)
    );

    assert.equal(new Set(emoji).size, emoji.length);
    for (const glyph of [...emoji, ...QUICK_REACTIONS]) {
      assert.equal(countEmojiOnly(glyph), 1, glyph);
    }
  });

  it("finds emoji by any part of their name", () => {
    assert.deepEqual(
      searchEmoji(":thumbs").map((item) => item.emoji),
      ["👍", "👎"]
    );
    assert.ok(searchEmoji("heart").length > 5);
    assert.deepEqual(searchEmoji("xyzzy"), []);
    assert.deepEqual(searchEmoji("  "), []);
  });

  it("names emoji outside the list generically", () => {
    assert.deepEqual(findEmoji("🔥"), { emoji: "🔥", name: "fire" });
    assert.deepEqual(findEmoji("🦩"), { emoji: "🦩", name: "emoji" });
  });
});

describe("addRecentEmoji", () => {
  it("moves the emoji to the front without duplicates", () => {
    assert.deepEqual(addRecentEmoji(["🔥", "😂", "👍"], "👍"), [
      "👍",
      "🔥",
      "😂",
    ]);
  });

  it("keeps a bounded list", () => {
    const full = Array.from({ length: MAX_RECENT_EMOJI }, (_, index) =>
      String.fromCodePoint(0x1f600 + index)
    );

    const updated = addRecentEmoji(full, "🔥");

    assert.equal(updated.length, MAX_RECENT_EMOJI);
    assert.equal(updated[0], "🔥");
  });
});
