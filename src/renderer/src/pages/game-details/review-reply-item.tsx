import { useState } from "react";
import { TrashIcon } from "@primer/octicons-react";
import { ThumbsUp, ThumbsDown, Languages } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { GameReviewAnswer } from "@types";

import { getReviewTranslationLanguage, sanitizeHtml } from "@shared";
import { useDate } from "@renderer/hooks";
import { formatNumber } from "@renderer/helpers";
import { Avatar } from "@renderer/components";

interface ReviewReplyItemProps {
  reply: GameReviewAnswer;
  userDetailsId?: string;
  isVoting: boolean;
  onVote: (answerId: string, voteType: "upvote" | "downvote") => void;
  onDelete: (answerId: string) => void;
}

export function ReviewReplyItem({
  reply,
  userDetailsId,
  isVoting,
  onVote,
  onDelete,
}: Readonly<ReviewReplyItemProps>) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("game_details");
  const { formatDistance, formatDateTime } = useDate();

  const [showOriginal, setShowOriginal] = useState(false);

  const isOwnReply = userDetailsId === reply.user.id;

  const getBaseLanguage = (lang: string | null) => lang?.split("-")[0] || "";

  const isDifferentLanguage =
    getBaseLanguage(reply.detectedLanguage) !== getBaseLanguage(i18n.language);
  const replyTranslationLanguage = getReviewTranslationLanguage(i18n.language);

  const needsTranslation =
    !isOwnReply &&
    isDifferentLanguage &&
    reply.translations[replyTranslationLanguage];

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
    ? reply.translations[replyTranslationLanguage]
    : reply.answerHtml;

  const getVoteButtonCursor = () => {
    if (userDetailsId && isVoting) return "not-allowed";
    if (userDetailsId) return "pointer";
    return "default";
  };

  const voteButtonCursor = getVoteButtonCursor();

  return (
    <div className="game-details__reply-item">
      <div className="game-details__reply-header">
        <button
          onClick={() => navigate(`/profile/${reply.user.id}`)}
          title={reply.user.displayName}
        >
          <Avatar
            src={reply.user.profileImageUrl}
            alt={reply.user.displayName || "User"}
            size={28}
          />
        </button>
        <button
          className="game-details__review-display-name game-details__review-display-name--clickable"
          onClick={() => reply.user.id && navigate(`/profile/${reply.user.id}`)}
        >
          {reply.user.displayName || "Anonymous"}
        </button>
        <span
          className="game-details__reply-date"
          title={formatDateTime(new Date(reply.createdAt))}
        >
          {formatDistance(new Date(reply.createdAt), new Date(), {
            addSuffix: true,
          })}
        </span>
      </div>

      <div
        className="game-details__review-content game-details__reply-content"
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
                  language: getLanguageName(reply.detectedLanguage),
                })}
          </button>
          {showOriginal && (
            <div
              className="game-details__review-content game-details__reply-content"
              style={{
                opacity: 0.6,
                marginTop: "8px",
              }}
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(reply.answerHtml),
              }}
            />
          )}
        </>
      )}

      <div className="game-details__reply-actions">
        <div className="game-details__review-votes">
          <motion.button
            className={`game-details__vote-button game-details__vote-button--upvote ${reply.hasUpvoted ? "game-details__vote-button--active" : ""}`}
            onClick={() => onVote(reply.id, "upvote")}
            disabled={isVoting || !userDetailsId}
            style={{
              opacity: isVoting ? 0.5 : 1,
              cursor: voteButtonCursor,
            }}
            animate={
              reply.hasUpvoted
                ? { scale: [1, 1.2, 1], transition: { duration: 0.3 } }
                : {}
            }
          >
            <ThumbsUp size={14} />
            <span>{formatNumber(reply.upvotes || 0)}</span>
          </motion.button>
          <motion.button
            className={`game-details__vote-button game-details__vote-button--downvote ${reply.hasDownvoted ? "game-details__vote-button--active" : ""}`}
            onClick={() => onVote(reply.id, "downvote")}
            disabled={isVoting || !userDetailsId}
            style={{
              opacity: isVoting ? 0.5 : 1,
              cursor: voteButtonCursor,
            }}
            animate={
              reply.hasDownvoted
                ? { scale: [1, 1.2, 1], transition: { duration: 0.3 } }
                : {}
            }
          >
            <ThumbsDown size={14} />
            <span>{formatNumber(reply.downvotes || 0)}</span>
          </motion.button>
        </div>

        {isOwnReply && (
          <button
            className="game-details__delete-review-button game-details__delete-reply-button"
            onClick={() => onDelete(reply.id)}
            title={t("delete_reply")}
          >
            <TrashIcon size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
