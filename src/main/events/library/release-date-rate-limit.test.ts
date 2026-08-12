import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getRateLimitDelay,
  RATE_LIMIT_FALLBACK_DELAY_MS,
} from "./release-date-rate-limit.ts";

describe("release date rate limit", () => {
  it("uses the longest retry delay in a batch", () => {
    assert.equal(
      getRateLimitDelay([
        { type: "not_found" },
        { type: "rate_limited", retryAfterMs: 1_000 },
        { type: "rate_limited", retryAfterMs: 5_000 },
      ]),
      5_000
    );
  });

  it("uses the fallback delay when Steam omits Retry-After", () => {
    assert.equal(
      getRateLimitDelay([{ type: "rate_limited", retryAfterMs: null }]),
      RATE_LIMIT_FALLBACK_DELAY_MS
    );
  });

  it("does not delay batches without rate limiting", () => {
    assert.equal(
      getRateLimitDelay([{ type: "not_found" }, { type: "error" }]),
      0
    );
  });
});
