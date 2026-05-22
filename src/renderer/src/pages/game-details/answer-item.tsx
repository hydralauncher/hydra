import {
  ThumbsUp,
  ThumbsDown,
  Languages,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import type { GameReviewAnswer } from "@types";

import { sanitizeHtml } from "@shared";
import { useDate } from "@renderer/hooks";
import { formatNumber } from "@renderer/helpers";
import { Avatar } from "@renderer/components";
import { DropdownMenu } from "@renderer/components/dropdown-menu/dropdown-menu";

import "./answer-item.scss";

interface AnswerItemProps {
  answer: GameReviewAnswer;
  userDetailsId?: string;
  isVoting: boolean;
  previousVotes: { upvotes: number; downvotes: number };
  onVote: (answerId: string, voteType: "upvote" | "downvote") => void;
  onDelete: (answerId: string) => void;
  onAnimationComplete: (
    answerId: string,
    votes: { upvotes: number; downvotes: number }
  ) => void;
}

export function AnswerItem({
  answer,
  userDetailsId,
  isVoting,
  previousVotes,
  onVote,
  onDelete,
  onAnimationComplete,
}: Readonly<AnswerItemProps>) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("game_details");
  const { formatDistance } = useDate();

  const [showOriginal, setShowOriginal] = useState(false);

  const getBaseLanguage = (lang: string | null) => lang?.split("-")[0] || "";

  const isDifferentLanguage =
    getBaseLanguage(answer.detectedLanguage) !== getBaseLanguage(i18n.language);

  const isOwnAnswer = userDetailsId === answer.user.id;

  const needsTranslation =
    !isOwnAnswer && isDifferentLanguage && answer.translations[i18n.language];

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
    ? answer.translations[i18n.language]
    : answer.answerHtml;

  return (
    <div className="game-details__answer-item">
      <div className="game-details__answer-header">
        <div className="game-details__answer-user">
          <button
            onClick={() => navigate(`/profile/${answer.user.id}`)}
            title={answer.user.displayName}
          >
            <Avatar
              src={answer.user.profileImageUrl}
              alt={answer.user.displayName || "User"}
              size={32}
            />
          </button>
          <div className="game-details__answer-user-info">
            <button
              className="game-details__answer-display-name"
              onClick={() =>
                answer.user.id && navigate(`/profile/${answer.user.id}`)
              }
            >
              {answer.user.displayName || "Anonymous"}
            </button>
          </div>
        </div>
        <div className="game-details__answer-date">
          {formatDistance(new Date(answer.createdAt), new Date(), {
            addSuffix: true,
          })}
        </div>
      </div>

      <div>
        <div
          className="game-details__answer-content"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(displayContent) }}
        />
        {needsTranslation && (
          <>
            <button
              className="game-details__answer-translation-toggle"
              onClick={() => setShowOriginal(!showOriginal)}
            >
              <Languages size={13} />
              {showOriginal
                ? t("hide_original")
                : t("show_original_translated_from", {
                    language: getLanguageName(answer.detectedLanguage),
                  })}
            </button>
            {showOriginal && (
              <div
                className="game-details__answer-content"
                style={{ opacity: 0.6, marginTop: "12px" }}
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(answer.answerHtml),
                }}
              />
            )}
          </>
        )}
      </div>

      <div className="game-details__answer-actions">
        <div className="game-details__answer-votes">
          <motion.button
            className={`game-details__answer-vote-button ${answer.hasUpvoted ? "game-details__answer-vote-button--active" : ""}`}
            onClick={() => onVote(answer.id, "upvote")}
            disabled={isVoting}
            title={t("upvote")}
            style={{
              opacity: isVoting ? 0.5 : 1,
              cursor: isVoting ? "not-allowed" : "pointer",
            }}
            animate={
              answer.hasUpvoted
                ? { scale: [1, 1.2, 1], transition: { duration: 0.3 } }
                : {}
            }
          >
            <ThumbsUp size={14} />
            <AnimatePresence mode="wait">
              <motion.span
                key={answer.upvotes || 0}
                custom={(answer.upvotes || 0) > previousVotes.upvotes}
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
                onAnimationComplete={() =>
                  onAnimationComplete(answer.id, {
                    upvotes: answer.upvotes || 0,
                    downvotes: answer.downvotes || 0,
                  })
                }
              >
                {formatNumber(answer.upvotes || 0)}
              </motion.span>
            </AnimatePresence>
          </motion.button>

          <motion.button
            className={`game-details__answer-vote-button ${answer.hasDownvoted ? "game-details__answer-vote-button--active" : ""}`}
            onClick={() => onVote(answer.id, "downvote")}
            disabled={isVoting}
            title={t("downvote")}
            style={{
              opacity: isVoting ? 0.5 : 1,
              cursor: isVoting ? "not-allowed" : "pointer",
            }}
            animate={
              answer.hasDownvoted
                ? { scale: [1, 1.2, 1], transition: { duration: 0.3 } }
                : {}
            }
          >
            <ThumbsDown size={14} />
            <AnimatePresence mode="wait">
              <motion.span
                key={answer.downvotes || 0}
                custom={(answer.downvotes || 0) > previousVotes.downvotes}
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
                onAnimationComplete={() =>
                  onAnimationComplete(answer.id, {
                    upvotes: answer.upvotes || 0,
                    downvotes: answer.downvotes || 0,
                  })
                }
              >
                {formatNumber(answer.downvotes || 0)}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>

        {isOwnAnswer && (
          <DropdownMenu
            items={[
              {
                label: t("remove_answer"),
                icon: <Trash2 size={14} />,
                onClick: () => onDelete(answer.id),
              },
            ]}
          >
            <button className="game-details__answer-more-button">
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
