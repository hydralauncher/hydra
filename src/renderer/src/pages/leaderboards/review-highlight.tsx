import { ArrowRightIcon } from "@primer/octicons-react";
import { Star, ThumbsUp } from "lucide-react";
import cn from "classnames";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Avatar } from "@renderer/components";
import { REVIEW_BANNER_IMAGE_SIZE } from "@renderer/constants";
import { useDate, useFormat, useProcessedImage } from "@renderer/hooks";
import { buildGameDetailsPath } from "@renderer/helpers";
import type { GameShop } from "@types";
import type { LeaderboardEntry } from "../game-details/leaderboard/game-leaderboard";
import type { LeaderboardReview } from "./global-leaderboard";

import "../game-details/review-item.scss";

const RATING_KEYS: Record<number, string> = {
  1: "rating_very_negative",
  2: "rating_negative",
  3: "rating_neutral",
  4: "rating_positive",
  5: "rating_very_positive",
};

export interface ReviewHighlightProps {
  entry: LeaderboardEntry;
  review: LeaderboardReview;
}

// The selected review, drawn like a review on the game page (review-item.tsx)
// without the vote buttons, replies and translation: the leaderboard payload
// has no review id. The game is a link line above the text.
export function ReviewHighlight({
  entry,
  review,
}: Readonly<ReviewHighlightProps>) {
  const { t } = useTranslation("leaderboards");
  const { t: tGame } = useTranslation("game_details");
  const { formatDistance, formatDateTime } = useDate();
  const { numberFormatter } = useFormat();
  const navigate = useNavigate();
  const bannerImageUrl = useProcessedImage(
    entry.user.backgroundImageUrl,
    REVIEW_BANNER_IMAGE_SIZE
  );
  const createdAt = review.createdAt ? new Date(review.createdAt) : null;
  const ratingKey = RATING_KEYS[Math.round(review.score)];
  const openProfile = () => navigate(`/profile/${entry.user.id}`);

  return (
    <article className="game-details__review-item leaderboards__review">
      <div
        className={cn("game-details__review-header", {
          "game-details__review-header--has-bg": bannerImageUrl,
        })}
      >
        {bannerImageUrl && (
          <img
            src={bannerImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="game-details__review-banner"
          />
        )}
        <div className="game-details__review-header-top">
          <div className="game-details__review-user">
            <button
              type="button"
              onClick={openProfile}
              title={entry.user.displayName}
            >
              <Avatar
                src={entry.user.profileImageUrl}
                alt={entry.user.displayName}
                size={56}
              />
            </button>
            <div className="game-details__review-user-info">
              <div className="game-details__review-name-row">
                <button
                  type="button"
                  className="game-details__review-display-name game-details__review-display-name--clickable"
                  onClick={openProfile}
                >
                  {entry.user.displayName}
                </button>
              </div>
              <div className="game-details__review-meta-row">
                <div className="game-details__review-meta-left">
                  <div className="game-details__review-score-stars">
                    <Star
                      size={12}
                      fill="currentColor"
                      className="game-details__review-star game-details__review-star--filled"
                    />
                    <span className="game-details__review-score-text">
                      {t("review_score", { score: review.score })}
                    </span>
                    {ratingKey && (
                      <span className="leaderboards__review-rating">
                        {tGame(ratingKey)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          {createdAt && (
            <div
              className="game-details__review-date"
              title={formatDateTime(createdAt)}
            >
              {formatDistance(createdAt, new Date(), { addSuffix: true })}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        className="leaderboards__link leaderboards__review-game"
        onClick={() =>
          navigate(
            buildGameDetailsPath({
              shop: review.shop as GameShop,
              objectId: review.objectId,
              title: review.gameTitle,
            })
          )
        }
      >
        {review.gameTitle}
        <ArrowRightIcon size={14} />
      </button>

      <p className="game-details__review-content leaderboards__review-text">
        {review.text}
      </p>

      <div className="game-details__review-actions">
        <div className="game-details__review-actions-left">
          <div className="game-details__review-votes">
            <span className="game-details__vote-button leaderboards__review-votes">
              <ThumbsUp size={16} />
              <span>{numberFormatter.format(entry.value)}</span>
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
