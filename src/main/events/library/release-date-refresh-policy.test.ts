import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getReleaseDateNextCheckAt,
  needsReleaseDateRefresh,
  RELEASE_DATE_RECHECK_INTERVALS,
} from "./release-date-refresh-policy.ts";

describe("release date refresh policy", () => {
  const now = Date.UTC(2026, 0, 1);

  it("does not refresh games with a known release date", () => {
    assert.equal(
      needsReleaseDateRefresh(
        { releaseDateTimestamp: Date.UTC(2025, 0, 1) },
        now
      ),
      false
    );
  });

  it("refreshes games that have never been checked or whose retry time elapsed", () => {
    assert.equal(needsReleaseDateRefresh({}, now), true);
    assert.equal(
      needsReleaseDateRefresh({ releaseDateNextCheckAt: now }, now),
      true
    );
    assert.equal(
      needsReleaseDateRefresh({ releaseDateNextCheckAt: now + 1 }, now),
      false
    );
  });

  it("uses distinct retry intervals for coming soon, missing and transient failures", () => {
    assert.equal(
      getReleaseDateNextCheckAt({ now, result: "coming_soon" }),
      now + RELEASE_DATE_RECHECK_INTERVALS.comingSoon
    );
    assert.equal(
      getReleaseDateNextCheckAt({ now, result: "not_found" }),
      now + RELEASE_DATE_RECHECK_INTERVALS.unavailable
    );
    assert.equal(
      getReleaseDateNextCheckAt({ now, result: "error" }),
      now + RELEASE_DATE_RECHECK_INTERVALS.transientError
    );
  });

  it("honors a rate-limit retry after without retrying more often than hourly", () => {
    assert.equal(
      getReleaseDateNextCheckAt({
        now,
        result: "rate_limited",
        retryAfterMs: 3 * 60 * 60 * 1000,
      }),
      now + 3 * 60 * 60 * 1000
    );
    assert.equal(
      getReleaseDateNextCheckAt({
        now,
        result: "rate_limited",
        retryAfterMs: 1,
      }),
      now + RELEASE_DATE_RECHECK_INTERVALS.transientError
    );
  });
});
