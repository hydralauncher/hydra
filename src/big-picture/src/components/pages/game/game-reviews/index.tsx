import {
  StarIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { sanitizeHtml } from "@shared";
import type { GameReview, GameShop } from "@types";
import { useCallback, useEffect, useRef, useState } from "react";
import { IS_DESKTOP } from "../../../../constants";
import { useDate, useFormat } from "../../../../hooks";
import { Button, Typography } from "../../../common";

interface GameReviewsProps {
  shop: GameShop;
  objectId: string;
}

const REVIEWS_PER_PAGE = 24;

export function GameReviews({ shop, objectId }: Readonly<GameReviewsProps>) {
  const [reviews, setReviews] = useState<GameReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [totalReviewCount, setTotalReviewCount] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [votingReviews, setVotingReviews] = useState<Set<string>>(new Set());

  const { formatDistance } = useDate();
  const { formatPlayTime } = useFormat();
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadReviews = useCallback(
    async (requestedPage: number, reset = false) => {
      if (!IS_DESKTOP || !objectId || shop === "custom") return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setReviewsLoading(true);

      try {
        const skip = reset ? 0 : requestedPage * REVIEWS_PER_PAGE;
        const params = new URLSearchParams({
          take: String(REVIEWS_PER_PAGE),
          skip: String(skip),
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
    [objectId, shop]
  );

  const loadMore = () => {
    if (!reviewsLoading && hasMore) {
      setPage((prev) => prev + 1);
    }
  };

  const handleVote = async (
    reviewId: string,
    voteType: "upvote" | "downvote"
  ) => {
    if (!objectId || votingReviews.has(reviewId)) return;

    setVotingReviews((prev) => new Set(prev).add(reviewId));

    const reviewIndex = reviews.findIndex((review) => review.id === reviewId);

    if (reviewIndex === -1) {
      setVotingReviews((prev) => {
        const next = new Set(prev);
        next.delete(reviewId);
        return next;
      });
      return;
    }

    const review = reviews[reviewIndex];
    const originalReview = { ...review };
    const updatedReviews = [...reviews];
    const updatedReview = { ...review };

    if (voteType === "upvote") {
      if (review.hasUpvoted) {
        updatedReview.hasUpvoted = false;
        updatedReview.upvotes = Math.max(0, (review.upvotes || 0) - 1);
      } else {
        updatedReview.hasUpvoted = true;
        updatedReview.upvotes = (review.upvotes || 0) + 1;

        if (review.hasDownvoted) {
          updatedReview.hasDownvoted = false;
          updatedReview.downvotes = Math.max(0, (review.downvotes || 0) - 1);
        }
      }
    } else {
      if (review.hasDownvoted) {
        updatedReview.hasDownvoted = false;
        updatedReview.downvotes = Math.max(0, (review.downvotes || 0) - 1);
      } else {
        updatedReview.hasDownvoted = true;
        updatedReview.downvotes = (review.downvotes || 0) + 1;

        if (review.hasUpvoted) {
          updatedReview.hasUpvoted = false;
          updatedReview.upvotes = Math.max(0, (review.upvotes || 0) - 1);
        }
      }
    }

    updatedReviews[reviewIndex] = updatedReview;
    setReviews(updatedReviews);

    try {
      await globalThis.window.electron.hydraApi.put(
        `/games/${shop}/${objectId}/reviews/${reviewId}/${voteType}`,
        { data: {} }
      );
    } catch (error) {
      console.error(`Failed to ${voteType} review:`, error);

      const rolledBackReviews = [...reviews];
      rolledBackReviews[reviewIndex] = originalReview;
      setReviews(rolledBackReviews);
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

  useEffect(() => {
    loadReviews(0, true);
  }, [objectId, shop, loadReviews]);

  useEffect(() => {
    if (page > 0) {
      loadReviews(page, false);
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
    <section className="game-page__comments">
      <div className="game-page__comments-header">
        <Typography className="game-page__comments-title">Comments</Typography>
        <Typography className="game-page__comments-count">
          {totalReviewCount}
        </Typography>
      </div>

      {reviews.length === 0 ? (
        <div className="game-page__comments-empty">
          <Typography>No comments yet</Typography>
        </div>
      ) : (
        <div className="game-page__comments-feed">
          {reviews.map((review) => (
            <article key={review.id} className="game-page__comment-card">
              <div className="game-page__comment-card-top">
                <div className="game-page__comment-header">
                  <div className="game-page__comment-user">
                    {review.user.profileImageUrl ? (
                      <img
                        src={review.user.profileImageUrl}
                        alt={review.user.displayName || "Anonymous"}
                        className="game-page__comment-avatar"
                      />
                    ) : (
                      <div className="game-page__comment-avatar game-page__comment-avatar--placeholder">
                        <UserIcon size={20} weight="regular" />
                      </div>
                    )}

                    <div className="game-page__comment-meta">
                      <div className="game-page__comment-name-row">
                        <Typography className="game-page__comment-display-name">
                          {review.user.displayName || "Anonymous"}
                        </Typography>

                        <Typography className="game-page__comment-date">
                          {formatDistance(
                            new Date(review.createdAt),
                            new Date(),
                            {
                              addSuffix: true,
                            }
                          )}
                        </Typography>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className="game-page__comment-body"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(review.reviewHtml),
                  }}
                />
              </div>

              <div className="game-page__comment-card-bottom">
                <div className="game-page__comment-feedback">
                  <button
                    className={`game-page__comment-feedback-item ${review.hasUpvoted ? "game-page__comment-feedback-item--active" : ""}`}
                    type="button"
                    onClick={() => handleVote(review.id, "upvote")}
                    disabled={votingReviews.has(review.id)}
                    aria-label="Like comment"
                  >
                    <ThumbsUpIcon
                      size={20}
                      weight={review.hasUpvoted ? "fill" : "regular"}
                    />
                    <Typography>{review.upvotes ?? 0}</Typography>
                  </button>

                  <button
                    className={`game-page__comment-feedback-item ${review.hasDownvoted ? "game-page__comment-feedback-item--active" : ""}`}
                    type="button"
                    onClick={() => handleVote(review.id, "downvote")}
                    disabled={votingReviews.has(review.id)}
                    aria-label="Dislike comment"
                  >
                    <ThumbsDownIcon
                      size={20}
                      weight={review.hasDownvoted ? "fill" : "regular"}
                    />
                    <Typography>{review.downvotes ?? 0}</Typography>
                  </button>
                </div>

                <div className="game-page__comment-review-meta">
                  <div className="game-page__comment-review-rating">
                    <StarIcon size={20} weight="fill" />
                    <span className="game-page__comment-review-rating-value">
                      {review.score}/5
                    </span>
                    <span className="game-page__comment-review-rating-copy">
                      {review.playTimeInSeconds && review.playTimeInSeconds > 0
                        ? `after playing for ${formatPlayTime(review.playTimeInSeconds)}`
                        : "rating"}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {hasMore && reviews.length > 0 && (
        <div className="game-page__comments-load-more">
          <Button
            focusable={false}
            variant="rounded"
            onClick={loadMore}
            disabled={reviewsLoading}
            loading={reviewsLoading}
          >
            Load More
          </Button>
        </div>
      )}
    </section>
  );
}
