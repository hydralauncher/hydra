export interface SteamReviewSummary {
  /** Steam's label for the overall rating, e.g. "Very Positive". */
  reviewScoreDesc: string;
  totalReviews: number;
}

/**
 * Reads the `query_summary` block of Steam's app reviews response.
 * Returns null when the response is malformed or the game has no reviews.
 */
export function parseSteamReviewSummary(
  payload: unknown
): SteamReviewSummary | null {
  if (!payload || typeof payload !== "object") return null;

  const { success, query_summary: summary } = payload as {
    success?: unknown;
    query_summary?: unknown;
  };

  if (success !== 1 || !summary || typeof summary !== "object") return null;

  const { review_score_desc: label, total_reviews: total } = summary as {
    review_score_desc?: unknown;
    total_reviews?: unknown;
  };

  if (typeof label !== "string" || !label.trim()) return null;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return {
    reviewScoreDesc: label.trim(),
    totalReviews: Math.trunc(total),
  };
}
