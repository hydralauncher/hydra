import { TrashIcon, ClockIcon } from "@primer/octicons-react";
import { ThumbsUp, ThumbsDown, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { GameReview } from "@types";

import { sanitizeHtml } from "@shared";
import { useDate } from "@renderer/hooks";
import { formatNumber } from "@renderer/helpers";
import { Avatar } from "@renderer/components";

interface ReviewItemProps {
  review: GameReview;
  userDetailsId?: string;
  isBlocked: boolean;
  isVisible: boolean;
  isVoting: boolean;
  previousVotes: { upvotes: number; downvotes: number };
  onVote: (reviewId: string, voteType: "upvote" | "downvote") => void;
  onDelete: (reviewId: string) => void;
  onToggleVisibility: (reviewId: string) => void;
  onAnimationComplete: (
    reviewId: string,
    votes: { upvotes: number; downvotes: number }
  ) => void;
}

const getScoreColorClass = (score: number): string => {
  if (score >= 1 && score <= 2) return "game-details__review-score--red";
  if (score >= 3 && score <= 3) return "game-details__review-score--yellow";
  if (score >= 4 && score <= 5) return "game-details__review-score--green";
  return "";
};

const getRatingText = (score: number, t: (key: string) => string): string => {
  switch (score) {
    case 1:
      return t("rating_very_negative");
    case 2:
      return t("rating_negative");
    case 3:
      return t("rating_neutral");
    case 4:
      return t("rating_positive");
    case 5:
      return t("rating_very_positive");
    default:
      return "";
  }
};

export function ReviewItem({
  review,
  userDetailsId,
  isBlocked,
  isVisible,
  isVoting,
  previousVotes,
  onVote,
  onDelete,
  onToggleVisibility,
  onAnimationComplete,
}: Readonly<ReviewItemProps>) {
  const navigate = useNavigate();
  const { t } = useTranslation("game_details");
  const { formatDistance } = useDate();

  if (isBlocked && !isVisible) {
    return (
      <div className="game-details__review-item">
        <div className="game-details__blocked-review-simple">
          Review from blocked user —{" "}
          <button
            className="game-details__blocked-review-show-link"
            onClick={() => onToggleVisibility(review.id)}
          >
            Show
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-details__review-item">
      <div className="game-details__review-header">
        <div className="game-details__review-user">
          <button
            onClick={() => navigate(`/profile/${review.user.id}`)}
            title={review.user.displayName}
          >
            <Avatar
              src={review.user.profileImageUrl}
              alt={review.user.displayName || "User"}
              size={40}
            />
          </button>
          <div className="game-details__review-user-info">
            <button
              className="game-details__review-display-name game-details__review-display-name--clickable"
              onClick={() =>
                review.user.id && navigate(`/profile/${review.user.id}`)
              }
            >
              {review.user.displayName || "Anonymous"}
            </button>
            <div className="game-details__review-date">
              <ClockIcon size={12} />
              {formatDistance(new Date(review.createdAt), new Date(), {
                addSuffix: true,
              })}
            </div>
          </div>
        </div>
        <div
          className="game-details__review-score-stars"
          title={getRatingText(review.score, t)}
        >
          {[1, 2, 3, 4, 5].map((starValue) => (
            <Star
              key={starValue}
              size={20}
              fill={starValue <= review.score ? "currentColor" : "none"}
              className={`game-details__review-star ${
                starValue <= review.score
                  ? "game-details__review-star--filled"
                  : "game-details__review-star--empty"
              } ${
                starValue <= review.score
                  ? getScoreColorClass(review.score)
                  : ""
              }`}
            />
          ))}
        </div>
      </div>
      <div
        className="game-details__review-content"
        dangerouslySetInnerHTML={{
          __html: sanitizeHtml(review.reviewHtml),
        }}
      />
      <div className="game-details__review-actions">
        <div className="game-details__review-votes">
          <motion.button
            className={`game-details__vote-button game-details__vote-button--upvote ${review.hasUpvoted ? "game-details__vote-button--active" : ""}`}
            onClick={() => onVote(review.id, "upvote")}
            disabled={isVoting}
            style={{
              opacity: isVoting ? 0.5 : 1,
              cursor: isVoting ? "not-allowed" : "pointer",
            }}
            animate={
              review.hasUpvoted
                ? {
                    scale: [1, 1.2, 1],
                    transition: { duration: 0.3 },
                  }
                : {}
            }
          >
            <ThumbsUp size={16} />
            <AnimatePresence mode="wait">
              <motion.span
                key={review.upvotes || 0}
                custom={(review.upvotes || 0) > previousVotes.upvotes}
                variants={{
                  enter: (isIncreasing: boolean) => ({
                    y: isIncreasing ? 10 : -10,
                    opacity: 0,
                  }),
                  center: { y: 0, opacity: 1 },
                  exit: (isIncreasing: boolean) => ({
                    y: isIncreasing ? -10 : 10,
                    opacity: 0,
                  }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.2 }}
                onAnimationComplete={() => {
                  onAnimationComplete(review.id, {
                    upvotes: review.upvotes || 0,
                    downvotes: review.downvotes || 0,
                  });
                }}
              >
                {formatNumber(review.upvotes || 0)}
              </motion.span>
            </AnimatePresence>
          </motion.button>
          <motion.button
            className={`game-details__vote-button game-details__vote-button--downvote ${review.hasDownvoted ? "game-details__vote-button--active" : ""}`}
            onClick={() => onVote(review.id, "downvote")}
            disabled={isVoting}
            style={{
              opacity: isVoting ? 0.5 : 1,
              cursor: isVoting ? "not-allowed" : "pointer",
            }}
            animate={
              review.hasDownvoted
                ? {
                    scale: [1, 1.2, 1],
                    transition: { duration: 0.3 },
                  }
                : {}
            }
          >
            <ThumbsDown size={16} />
            <AnimatePresence mode="wait">
              <motion.span
                key={review.downvotes || 0}
                custom={(review.downvotes || 0) > previousVotes.downvotes}
                variants={{
                  enter: (isIncreasing: boolean) => ({
                    y: isIncreasing ? 10 : -10,
                    opacity: 0,
                  }),
                  center: { y: 0, opacity: 1 },
                  exit: (isIncreasing: boolean) => ({
                    y: isIncreasing ? -10 : 10,
                    opacity: 0,
                  }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.2 }}
                onAnimationComplete={() => {
                  onAnimationComplete(review.id, {
                    upvotes: review.upvotes || 0,
                    downvotes: review.downvotes || 0,
                  });
                }}
              >
                {formatNumber(review.downvotes || 0)}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>
        {userDetailsId === review.user.id && (
          <button
            className="game-details__delete-review-button"
            onClick={() => onDelete(review.id)}
            title={t("delete_review")}
          >
            <TrashIcon size={16} />
            <span>{t("remove_review")}</span>
          </button>
        )}
        {isBlocked && isVisible && (
          <button
            className="game-details__blocked-review-hide-link"
            onClick={() => onToggleVisibility(review.id)}
          >
            Hide
          </button>
        )}
      </div>
    </div>
  );
}
