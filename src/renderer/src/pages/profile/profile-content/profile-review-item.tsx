import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Clock,
  Star1,
  Like1,
  Dislike,
  Trash,
  LanguageSquare,
} from "iconsax-reactjs";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import type { GameShop } from "@types";
import { sanitizeHtml } from "@shared";
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
    shop: GameShop;
  };
  translations: {
    [key: string]: string;
  };
  detectedLanguage: string | null;
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
  const { t: tGameDetails, i18n } = useTranslation("game_details");
  const [showOriginal, setShowOriginal] = useState(false);

  const getBaseLanguage = (lang: string | null) => lang?.split("-")[0] || "";

  const isDifferentLanguage =
    getBaseLanguage(review.detectedLanguage) !== getBaseLanguage(i18n.language);

  const needsTranslation =
    !isOwnReview && isDifferentLanguage && review.translations[i18n.language];

  const getLanguageName = (languageCode: string | null) => {
    if (!languageCode) return "";
    try {
      const displayNames = new Intl.DisplayNames([i18n.language], {
        type: "language",
      });
      return displayNames.of(languageCode) || languageCode.toUpperCase();
    } catch {
      return languageCode.toUpperCase();
    }
  };

  const displayContent = needsTranslation
    ? review.translations[i18n.language]
    : review.reviewHtml;

  return (
    <motion.div
      key={review.id}
      className="user-reviews__review-item"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="user-reviews__review-header">
        <div className="user-reviews__review-header-top">
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
          <div className="user-reviews__review-date">
            {formatDistance(new Date(review.createdAt), new Date(), {
              addSuffix: true,
            })}
          </div>
        </div>
        <div className="user-reviews__review-header-bottom">
          <div className="user-reviews__review-meta-row">
            <div
              className="user-reviews__review-score-stars"
              title={getRatingText(review.score, tGameDetails)}
            >
              <Star1
                size={12}
                variant="Linear"
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
                <Clock size={12} variant="Linear" />
                <span>
                  {tGameDetails("review_played_for")}{" "}
                  {formatPlayTime(review.playTimeInSeconds || 0)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <div
          className="user-reviews__review-content"
          dangerouslySetInnerHTML={{
            __html: sanitizeHtml(displayContent),
          }}
        />
        {needsTranslation && (
          <>
            <button
              className="user-reviews__review-translation-toggle"
              onClick={() => setShowOriginal(!showOriginal)}
            >
              <LanguageSquare size={13} variant="Linear" />
              {showOriginal
                ? tGameDetails("hide_original")
                : tGameDetails("show_original_translated_from", {
                    language: getLanguageName(review.detectedLanguage),
                  })}
            </button>
            {showOriginal && (
              <div
                className="user-reviews__review-content"
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
            <Like1 size={16} variant="Linear" />
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
            <Dislike size={14} variant="Linear" />
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
            <Trash size={14} variant="Linear" />
            <span>{t("delete_review")}</span>
          </button>
        )}
      </div>
    </motion.div>
  );
}
