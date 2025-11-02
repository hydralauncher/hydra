import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ClockIcon } from "@primer/octicons-react";
import { Star, ThumbsUp, ThumbsDown, TrashIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDate } from "@renderer/hooks";
import { buildGameDetailsPath } from "@renderer/helpers";
import "./profile-content.scss";

interface UserReview {
  id: string;
  reviewHtml: string;
  score: number;
  playTimeInSeconds?: number;
  upvotes: number;
  downvotes: number;
  hasUpvoted: boolean;
  hasDownvoted: boolean;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
  };
  game: {
    title: string;
    iconUrl: string;
    objectId: string;
    shop: string;
  };
}

interface ProfileReviewItemProps {
  review: UserReview;
  isOwnReview: boolean;
  isVoting: boolean;
  formatPlayTime: (playTimeInSeconds: number) => string;
  getRatingText: (score: number, t: (key: string) => string) => string;
  onVote: (reviewId: string, isUpvote: boolean) => void;
  onDelete: (reviewId: string) => void;
}

export function ProfileReviewItem({
  review,
  isOwnReview,
  isVoting,
  formatPlayTime,
  getRatingText,
  onVote,
  onDelete,
}: Readonly<ProfileReviewItemProps>) {
  const navigate = useNavigate();
  const { formatDistance } = useDate();
  const { t } = useTranslation("user_profile");
  const { t: tGameDetails } = useTranslation("game_details");

  return (
    <motion.div
      key={review.id}
      className="user-reviews__review-item"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="user-reviews__review-header">
        <div className="user-reviews__review-meta-row">
          <div
            className="user-reviews__review-score-stars"
            title={getRatingText(review.score, tGameDetails)}
          >
            <Star
              size={12}
              className="user-reviews__review-star user-reviews__review-star--filled"
            />
            <span className="user-reviews__review-score-text">
              {review.score}/5
            </span>
          </div>
          {Boolean(
            review.playTimeInSeconds && review.playTimeInSeconds > 0
          ) && (
            <div className="user-reviews__review-playtime">
              <ClockIcon size={12} />
              <span>
                {tGameDetails("review_played_for")}{" "}
                {formatPlayTime(review.playTimeInSeconds || 0)}
              </span>
            </div>
          )}
        </div>
        <div className="user-reviews__review-date">
          {formatDistance(new Date(review.createdAt), new Date(), {
            addSuffix: true,
          })}
        </div>
      </div>

      <div
        className="user-reviews__review-content"
        dangerouslySetInnerHTML={{
          __html: review.reviewHtml,
        }}
      />

      <div className="user-reviews__review-footer">
        <div className="user-reviews__review-game">
          <div className="user-reviews__game-info">
            <div className="user-reviews__game-details">
              <img
                src={review.game.iconUrl}
                alt={review.game.title}
                className="user-reviews__game-icon"
              />
              <button
                className="user-reviews__game-title user-reviews__game-title--clickable"
                onClick={() => navigate(buildGameDetailsPath(review.game))}
              >
                {review.game.title}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="user-reviews__review-actions">
        <div className="user-reviews__review-votes">
          <motion.button
            className={`user-reviews__vote-button ${review.hasUpvoted ? "user-reviews__vote-button--active" : ""}`}
            onClick={() => onVote(review.id, true)}
            disabled={isVoting}
            style={{
              opacity: isVoting ? 0.5 : 1,
              cursor: isVoting ? "not-allowed" : "pointer",
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <ThumbsUp size={14} />
            <AnimatePresence mode="wait">
              <motion.span
                key={review.upvotes}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
              >
                {review.upvotes}
              </motion.span>
            </AnimatePresence>
          </motion.button>

          <motion.button
            className={`user-reviews__vote-button ${review.hasDownvoted ? "user-reviews__vote-button--active" : ""}`}
            onClick={() => onVote(review.id, false)}
            disabled={isVoting}
            style={{
              opacity: isVoting ? 0.5 : 1,
              cursor: isVoting ? "not-allowed" : "pointer",
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <ThumbsDown size={14} />
            <AnimatePresence mode="wait">
              <motion.span
                key={review.downvotes}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
              >
                {review.downvotes}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>

        {isOwnReview && (
          <button
            className="user-reviews__delete-review-button"
            onClick={() => onDelete(review.id)}
            title={t("delete_review")}
          >
            <TrashIcon size={14} />
            <span>{t("delete_review")}</span>
          </button>
        )}
      </div>
    </motion.div>
  );
}

