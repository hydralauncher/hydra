import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_MESSAGE_MAX_LENGTH,
  getMessageLength,
  getOverflowRange,
  shouldShowLengthCounter,
} from "./chat-message-limit.js";

describe("getMessageLength", () => {
  it("ignores the whitespace the API trims", () => {
    assert.equal(getMessageLength("  hi \n"), 2);
  });
});

describe("shouldShowLengthCounter", () => {
  it("stays hidden well under the limit", () => {
    assert.equal(shouldShowLengthCounter(CHAT_MESSAGE_MAX_LENGTH / 2), false);
  });

  it("shows close to the limit", () => {
    assert.equal(shouldShowLengthCounter(CHAT_MESSAGE_MAX_LENGTH - 1), true);
  });
});

describe("getOverflowRange", () => {
  it("is null within the limit", () => {
    assert.equal(getOverflowRange("a".repeat(CHAT_MESSAGE_MAX_LENGTH)), null);
  });

  it("covers the characters past the limit", () => {
    assert.deepEqual(
      getOverflowRange("a".repeat(CHAT_MESSAGE_MAX_LENGTH + 5)),
      [CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_MAX_LENGTH + 5]
    );
  });

  it("skips leading and trailing whitespace", () => {
    const draft = `  ${"a".repeat(CHAT_MESSAGE_MAX_LENGTH + 3)}  `;

    assert.deepEqual(getOverflowRange(draft), [
      CHAT_MESSAGE_MAX_LENGTH + 2,
      CHAT_MESSAGE_MAX_LENGTH + 5,
    ]);
  });
});
