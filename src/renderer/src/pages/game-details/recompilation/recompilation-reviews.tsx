import { useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { LockIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import type { GameReview, RecompilationPort } from "@types";

import { ReviewItem } from "../review-item";
import { ReviewSortOptions } from "../review-sort-options";
import { SAMPLE_PORT_REVIEWS } from "./sample-reviews";

import "../game-reviews.scss";
import "../review-gate-notice.scss";

type ReviewSortOption =
  | "newest"
  | "oldest"
  | "score_high"
  | "score_low"
  | "most_voted";

const sortReviews = (reviews: GameReview[], sortBy: ReviewSortOption) => {
  const byDate = (review: GameReview) => new Date(review.createdAt).getTime();

  return [...reviews].sort((a, b) => {
    switch (sortBy) {
      case "oldest":
        return byDate(a) - byDate(b);
      case "score_high":
        return b.score - a.score || byDate(b) - byDate(a);
      case "score_low":
        return a.score - b.score || byDate(b) - byDate(a);
      case "most_voted":
        return b.upvotes - a.upvotes || byDate(b) - byDate(a);
      default:
        return byDate(b) - byDate(a);
    }
  });
};

/** Votes only change locally: sample reviews are never sent to the API. */
const applyVote = (review: GameReview, voteType: "upvote" | "downvote") => {
  const next = { ...review };

  if (voteType === "upvote") {
    next.upvotes += review.hasUpvoted ? -1 : 1;
    next.hasUpvoted = !review.hasUpvoted;
    if (review.hasDownvoted) {
      next.downvotes -= 1;
      next.hasDownvoted = false;
    }
  } else {
    next.downvotes += review.hasDownvoted ? -1 : 1;
    next.hasDownvoted = !review.hasDownvoted;
    if (review.hasUpvoted) {
      next.upvotes -= 1;
      next.hasUpvoted = false;
    }
  }

  return next;
};

// Sample reviewers have no Hydra profile, so the profile links stay inert.
const blockProfileNavigation = (event: MouseEvent<HTMLDivElement>) => {
  if ((event.target as HTMLElement).closest(".game-details__review-user")) {
    event.preventDefault();
    event.stopPropagation();
  }
};

interface RecompilationReviewsProps {
  port: RecompilationPort;
  isSignedIn: boolean;
}

/** GameReviews parts, scoped to one native PC port and fed with sample data. */
export function RecompilationReviews({
  port,
  isSignedIn,
}: Readonly<RecompilationReviewsProps>) {
  const { t } = useTranslation("game_details");

  const [reviews, setReviews] = useState(() => SAMPLE_PORT_REVIEWS[port.id]);
  const [sortBy, setSortBy] = useState<ReviewSortOption>("newest");
  const previousVotesRef = useRef(
    new Map<string, { upvotes: number; downvotes: number }>()
  );

  const sortedReviews = useMemo(
    () => sortReviews(reviews, sortBy),
    [reviews, sortBy]
  );

  const handleVote = (reviewId: string, voteType: "upvote" | "downvote") => {
    setReviews((current) =>
      current.map((review) =>
        review.id === reviewId ? applyVote(review, voteType) : review
      )
    );
  };

  return (
    <div className="game-details__reviews-section recompilation__reviews">
      <div className="game-details__reviews-header">
        <h3 className="game-details__reviews-title">{t("leave_a_review")}</h3>
      </div>

      <div className="review-gate-notice">
        <div className="review-gate-notice__icon">
          <LockIcon size={20} />
        </div>
        <div className="review-gate-notice__content">
          <span className="review-gate-notice__title">
            {t("review_locked_title")}
          </span>
          <span className="review-gate-notice__description">
            {isSignedIn
              ? t("recompilation_review_unavailable")
              : t("recompilation_review_requires_sign_in")}
          </span>
        </div>
      </div>

      <div className="game-details__reviews-separator" />

      <div className="game-details__reviews-list-header">
        <div className="game-details__reviews-title-group">
          <h3 className="game-details__reviews-title">
            {t("recompilation_reviews_title", { port: port.name })}
          </h3>
          <span className="game-details__reviews-badge">{reviews.length}</span>
        </div>
      </div>

      <ReviewSortOptions sortBy={sortBy} onSortChange={setSortBy} />

      {/* Capture phase only stops the avatar and name buttons of ReviewItem. */}
      <div
        className="game-details__reviews-container"
        onClickCapture={blockProfileNavigation}
      >
        {sortedReviews.map((review) => (
          <ReviewItem
            key={review.id}
            review={review}
            isBlocked={false}
            isVisible
            isVoting={false}
            previousVotes={
              previousVotesRef.current.get(review.id) ?? {
                upvotes: review.upvotes,
                downvotes: review.downvotes,
              }
            }
            onVote={handleVote}
            onDelete={() => {}}
            onToggleVisibility={() => {}}
            onAnimationComplete={(reviewId, votes) =>
              previousVotesRef.current.set(reviewId, votes)
            }
          />
        ))}
      </div>
    </div>
  );
}
