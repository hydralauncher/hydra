import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSteamReviewSummary } from "./steam-review-summary.js";

describe("parseSteamReviewSummary", () => {
  it("reads the rating label and review count", () => {
    assert.deepEqual(
      parseSteamReviewSummary({
        success: 1,
        query_summary: {
          review_score_desc: "Very Positive",
          total_positive: 23000,
          total_negative: 1583,
          total_reviews: 24583,
        },
      }),
      { reviewScoreDesc: "Very Positive", totalReviews: 24583 }
    );
  });

  it("returns null when the game has no reviews", () => {
    assert.equal(
      parseSteamReviewSummary({
        success: 1,
        query_summary: {
          review_score_desc: "No user reviews",
          total_reviews: 0,
        },
      }),
      null
    );
  });

  it("returns null for unsuccessful or malformed responses", () => {
    assert.equal(parseSteamReviewSummary(null), null);
    assert.equal(parseSteamReviewSummary("<html>Welcome</html>"), null);
    assert.equal(parseSteamReviewSummary({ success: 0 }), null);
    assert.equal(
      parseSteamReviewSummary({
        success: 1,
        query_summary: { review_score_desc: "", total_reviews: 5 },
      }),
      null
    );
    assert.equal(
      parseSteamReviewSummary({
        success: 1,
        query_summary: { review_score_desc: "Positive", total_reviews: "5" },
      }),
      null
    );
  });
});
