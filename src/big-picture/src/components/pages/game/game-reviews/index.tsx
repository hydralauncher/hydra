import {
  ClockIcon,
  StarIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@phosphor-icons/react";
import { sanitizeHtml } from "@shared";
import type { GameReview, GameShop } from "@types";
import { useCallback, useEffect, useRef, useState } from "react";
import { IS_DESKTOP } from "../../../../constants";
import { useDate, useFormat } from "../../../../hooks";
import {
  Box,
  Button,
  FocusItem,
  HorizontalFocusGroup,
  Typography,
} from "../../../common";

type ReviewSortOption =
  | "newest"
  | "oldest"
  | "score_high"
  | "score_low"
  | "most_voted";

interface GameReviewsProps {
  shop: GameShop;
  objectId: string;
}

const REVIEWS_PER_PAGE = 5;

export function GameReviews({ shop, objectId }: Readonly<GameReviewsProps>) {
  const [reviews, setReviews] = useState<GameReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [totalReviewCount, setTotalReviewCount] = useState(0);
  const [sortBy, setSortBy] = useState<ReviewSortOption>("newest");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [votingReviews, setVotingReviews] = useState<Set<string>>(new Set());

  const { formatDistance } = useDate();
  const { formatNumber, formatPlayTime } = useFormat();
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadReviews = useCallback(
    async (reset = false) => {
      if (!IS_DESKTOP || !objectId || shop === "custom") return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setReviewsLoading(true);
      try {
        const skip = reset ? 0 : page * REVIEWS_PER_PAGE;
        const params = new URLSearchParams({
          take: String(REVIEWS_PER_PAGE),
          skip: String(skip),
          sortBy,
        });

        const response = await globalThis.window.electron.hydraApi.get<{
          reviews: GameReview[];
          totalCount: number;
        }>(`/games/${shop}/${objectId}/reviews?${params.toString()}`, {
          needsAuth: false,
        });

        if (abortController.signal.aborted) return;

        const reviewsData = response?.reviews ?? [];
        const reviewCount = response?.totalCount ?? 0;

        if (reset) {
          setReviews(reviewsData);
          setPage(0);
        } else {
          setReviews((prev) => [...prev, ...reviewsData]);
        }

        setTotalReviewCount(reviewCount);
        setHasMore(reviewsData.length === REVIEWS_PER_PAGE);
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error("Failed to load reviews:", error);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setReviewsLoading(false);
        }
      }
    },
    [objectId, shop, page, sortBy]
  );

  const applyVote = (
    review: GameReview,
    voteType: "upvote" | "downvote"
  ): GameReview => {
    const updated = { ...review };

    const isToggleOff =
      (voteType === "upvote" && updated.hasUpvoted) ||
      (voteType === "downvote" && updated.hasDownvoted);

    if (isToggleOff) {
      if (voteType === "upvote") {
        updated.hasUpvoted = false;
        updated.upvotes = Math.max(0, (updated.upvotes || 0) - 1);
      } else {
        updated.hasDownvoted = false;
        updated.downvotes = Math.max(0, (updated.downvotes || 0) - 1);
      }
      return updated;
    }

    if (voteType === "upvote") {
      updated.hasUpvoted = true;
      updated.upvotes = (updated.upvotes || 0) + 1;
    } else if (voteType === "downvote") {
      updated.hasDownvoted = true;
      updated.downvotes = (updated.downvotes || 0) + 1;
    }

    if (voteType === "upvote" && updated.hasDownvoted) {
      updated.hasDownvoted = false;
      updated.downvotes = Math.max(0, (updated.downvotes || 0) - 1);
    } else if (voteType === "downvote" && updated.hasUpvoted) {
      updated.hasUpvoted = false;
      updated.upvotes = Math.max(0, (updated.upvotes || 0) - 1);
    }

    return updated;
  };

  const handleVote = async (
    reviewId: string,
    voteType: "upvote" | "downvote"
  ) => {
    if (!objectId || votingReviews.has(reviewId)) return;

    setVotingReviews((prev) => new Set(prev).add(reviewId));

    const reviewIndex = reviews.findIndex((r) => r.id === reviewId);
    if (reviewIndex === -1) {
      setVotingReviews((prev) => {
        const next = new Set(prev);
        next.delete(reviewId);
        return next;
      });
      return;
    }

    const originalReview = { ...reviews[reviewIndex] };
    const updatedReviews = [...reviews];
    updatedReviews[reviewIndex] = applyVote(originalReview, voteType);
    setReviews(updatedReviews);

    try {
      await globalThis.window.electron.hydraApi.put(
        `/games/${shop}/${objectId}/reviews/${reviewId}/${voteType}`,
        { data: {} }
      );
    } catch {
      const rolledBack = [...reviews];
      rolledBack[reviewIndex] = originalReview;
      setReviews(rolledBack);
    } finally {
      setTimeout(() => {
        setVotingReviews((prev) => {
          const next = new Set(prev);
          next.delete(reviewId);
          return next;
        });
      }, 500);
    }
  };

  const handleSortChange = (newSortBy: ReviewSortOption) => {
    if (newSortBy !== sortBy) {
      setSortBy(newSortBy);
      setPage(0);
      setHasMore(true);
    }
  };

  const loadMore = () => {
    if (!reviewsLoading && hasMore) {
      setPage((prev) => prev + 1);
    }
  };

  useEffect(() => {
    loadReviews(true);
  }, [sortBy, objectId, loadReviews]);

  useEffect(() => {
    if (page > 0) {
      loadReviews(false);
    }
  }, [page, loadReviews]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  if (reviewsLoading && reviews.length === 0) {
    return null;
  }

  return (
    <div className="game-page__box-group">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Typography>Reviews</Typography>

        <div
          style={{
            color: "rgba(255, 255, 255, 0.5)",
            padding: "4px 8px",
            borderRadius: "4px",
            backgroundColor: "rgba(255, 255, 255, 0.05)",
          }}
        >
          {totalReviewCount}
        </div>
      </div>

      <HorizontalFocusGroup regionId="game-page__review-sort-options" asChild>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button
            variant="link"
            size="small"
            onClick={() =>
              handleSortChange(sortBy === "newest" ? "oldest" : "newest")
            }
          >
            {sortBy === "oldest" ? "Oldest" : "Newest"}
          </Button>

          <Button
            variant="link"
            size="small"
            onClick={() =>
              handleSortChange(
                sortBy === "score_high" ? "score_low" : "score_high"
              )
            }
          >
            {sortBy === "score_low" ? "Lowest Score" : "Highest Score"}
          </Button>

          <Button
            variant="link"
            size="small"
            onClick={() => handleSortChange("most_voted")}
          >
            Most Voted
          </Button>
        </div>
      </HorizontalFocusGroup>

      {reviews.length === 0 ? (
        <Box>
          <Typography
            style={{ color: "rgba(255, 255, 255, 0.5)", textAlign: "center" }}
          >
            No reviews yet
          </Typography>
        </Box>
      ) : (
        reviews.map((review) => {
          const isVoting = votingReviews.has(review.id);

          const row = (
            <Box key={review.id} className="game-page__review-item">
              <div className="game-page__review-header">
                <div className="game-page__review-user">
                  {review.user.profileImageUrl ? (
                    <img
                      src={review.user.profileImageUrl}
                      alt={review.user.displayName}
                      className="game-page__review-avatar"
                    />
                  ) : (
                    <div className="game-page__review-avatar game-page__review-avatar--placeholder" />
                  )}

                  <div className="game-page__review-user-info">
                    <Typography className="game-page__review-display-name">
                      {review.user.displayName || "Anonymous"}
                    </Typography>

                    <div className="game-page__review-meta">
                      <div className="game-page__review-score">
                        <StarIcon size={12} weight="fill" />
                        <span>{review.score}/5</span>
                      </div>

                      {Boolean(
                        review.playTimeInSeconds && review.playTimeInSeconds > 0
                      ) && (
                        <div className="game-page__review-playtime">
                          <ClockIcon size={12} />
                          <span>
                            {formatPlayTime(review.playTimeInSeconds ?? 0)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <Typography className="game-page__review-date">
                  {formatDistance(new Date(review.createdAt), new Date(), {
                    addSuffix: true,
                  })}
                </Typography>
              </div>

              <div
                className="game-page__review-content"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(review.reviewHtml),
                }}
              />

              <HorizontalFocusGroup
                regionId={`review-votes-${review.id}`}
                asChild
              >
                <div className="game-page__review-votes">
                  <FocusItem asChild>
                    <button
                      className={`game-page__review-vote-button ${review.hasUpvoted ? "game-page__review-vote-button--active" : ""}`}
                      onClick={() => handleVote(review.id, "upvote")}
                      disabled={isVoting}
                      aria-label="Upvote"
                    >
                      <ThumbsUpIcon
                        size={14}
                        weight={review.hasUpvoted ? "fill" : "regular"}
                      />
                      <span>{formatNumber(review.upvotes || 0)}</span>
                    </button>
                  </FocusItem>

                  <FocusItem asChild>
                    <button
                      className={`game-page__review-vote-button ${review.hasDownvoted ? "game-page__review-vote-button--active-down" : ""}`}
                      onClick={() => handleVote(review.id, "downvote")}
                      disabled={isVoting}
                      aria-label="Downvote"
                    >
                      <ThumbsDownIcon
                        size={14}
                        weight={review.hasDownvoted ? "fill" : "regular"}
                      />
                      <span>{formatNumber(review.downvotes || 0)}</span>
                    </button>
                  </FocusItem>
                </div>
              </HorizontalFocusGroup>
            </Box>
          );

          return row;
        })
      )}

      {hasMore && !reviewsLoading && reviews.length > 0 && (
        <Button variant="rounded" onClick={loadMore}>
          Load More
        </Button>
      )}
    </div>
  );
}
