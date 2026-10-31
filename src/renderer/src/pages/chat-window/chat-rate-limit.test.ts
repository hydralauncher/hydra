import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_RATE_LIMIT_WINDOW_MS,
  createSendCooldown,
  getRateLimitWindowStart,
} from "./chat-rate-limit.js";

describe("getRateLimitWindowStart", () => {
  it("opens a window on the first send", () => {
    assert.equal(getRateLimitWindowStart(null, 5_000), 5_000);
  });

  it("keeps the open window for sends inside it", () => {
    assert.equal(getRateLimitWindowStart(5_000, 14_999), 5_000);
  });

  it("opens the next window once the current one ends", () => {
    assert.equal(
      getRateLimitWindowStart(5_000, 5_000 + CHAT_RATE_LIMIT_WINDOW_MS),
      5_000 + CHAT_RATE_LIMIT_WINDOW_MS
    );
  });
});

describe("createSendCooldown", () => {
  it("lasts until the window ends", () => {
    assert.deepEqual(createSendCooldown(1_000, 4_000), {
      startedAt: 4_000,
      until: 1_000 + CHAT_RATE_LIMIT_WINDOW_MS,
    });
  });

  it("lasts at least a second when the window has nearly ended", () => {
    assert.deepEqual(createSendCooldown(1_000, 10_900), {
      startedAt: 10_900,
      until: 11_900,
    });
  });
});
