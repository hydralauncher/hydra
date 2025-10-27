import { TrashIcon, ClockIcon } from "@primer/octicons-react";
import { ThumbsUp, ThumbsDown, Star, Languages } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import type { GameReview } from "@types";

import { sanitizeHtml } from "@shared";
import { useDate, useFormat } from "@renderer/hooks";
import { formatNumber } from "@renderer/helpers";
import { Avatar } from "@renderer/components";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";

import "./review-item.scss";

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
  const { t, i18n } = useTranslation("game_details");
  const { formatDistance } = useDate();
  const { numberFormatter } = useFormat();

  const [showOriginal, setShowOriginal] = useState(false);

  // Check if this is the user's own review
  const isOwnReview = userDetailsId === review.user.id;

  // Helper to get base language code (e.g., "pt" from "pt-BR")
  const getBaseLanguage = (lang: string) => lang.split("-")[0];

  // Check if the review is in a different language (comparing base language codes)
  const isDifferentLanguage =
    getBaseLanguage(review.detectedLanguage) !== getBaseLanguage(i18n.language);

  // Check if translation is available and needed (but not for own reviews)
  const needsTranslation =
    !isOwnReview &&
    isDifferentLanguage &&
    review.translations &&
    review.translations[i18n.language];

  // Get the full language name using Intl.DisplayNames
  const getLanguageName = (languageCode: string) => {
    try {
      const displayNames = new Intl.DisplayNames([i18n.language], {
        type: "language",
      });
      return displayNames.of(languageCode) || languageCode.toUpperCase();
    } catch {
      return languageCode.toUpperCase();
    }
  };

  // Format playtime similar to hero panel
  const formatPlayTime = (playTimeInSeconds: number) => {
    const minutes = playTimeInSeconds / 60;

    if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
      return t("amount_minutes", {
        amount: minutes.toFixed(0),
      });
    }

    const hours = minutes / 60;
    return t("amount_hours", { amount: numberFormatter.format(hours) });
  };

  // Determine which content to show - always show original for own reviews
  const displayContent = needsTranslation
    ? review.translations[i18n.language]
    : review.reviewHtml;

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
            <div className="game-details__review-meta-row">
              <div
                className="game-details__review-score-stars"
                title={getRatingText(review.score, t)}
              >
                <Star
                  size={12}
                  className="game-details__review-star game-details__review-star--filled"
                />
                <span className="game-details__review-score-text">
                  {review.score}/5
                </span>
              </div>
              {review.playTimeInSeconds && review.playTimeInSeconds > 0 && (
                <div className="game-details__review-playtime">
                  <ClockIcon size={12} />
                  <span>
                    {t("review_played_for")}{" "}
                    {formatPlayTime(review.playTimeInSeconds)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="game-details__review-right">
          <div className="game-details__review-date">
            <ClockIcon size={12} />
            {formatDistance(new Date(review.createdAt), new Date(), {
              addSuffix: true,
            })}
          </div>
        </div>
      </div>
      <div>
        <div
          className="game-details__review-content"
          dangerouslySetInnerHTML={{
            __html: sanitizeHtml(displayContent),
          }}
        />
        {needsTranslation && (
          <>
            <button
              className="game-details__review-translation-toggle"
              onClick={() => setShowOriginal(!showOriginal)}
            >
              <Languages size={13} />
              {showOriginal
                ? t("hide_original")
                : t("show_original_translated_from", {
                    language: getLanguageName(review.detectedLanguage),
                  })}
            </button>
            {showOriginal && (
              <div
                className="game-details__review-content"
                style={{
                  opacity: 0.6,
                  marginTop: "12px",
                }}
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(review.reviewHtml),
                }}
              />
            )}
          </>
        )}
      </div>
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
