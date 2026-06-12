import { useState } from "react";
import { ReplyIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import type { GameReview, GameReviewAnswer, GameShop } from "@types";

import { useToast } from "@renderer/hooks";

import { ReviewItem } from "./review-item";
import { ReviewReplyItem } from "./review-reply-item";
import { ReviewReplyComposer } from "./review-reply-composer";
import "./review-replies.scss";

interface ReviewThreadProps {
  shop: GameShop;
  objectId: string;
  review: GameReview;
  userDetailsId?: string;
  isVisible: boolean;
  isVoting: boolean;
  previousVotes: { upvotes: number; downvotes: number };
  onVoteReview: (reviewId: string, voteType: "upvote" | "downvote") => void;
  onDeleteReview: (reviewId: string) => void;
  onToggleVisibility: (reviewId: string) => void;
  onAnimationComplete: (
    reviewId: string,
    votes: { upvotes: number; downvotes: number }
  ) => void;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
}

const REPLIES_TAKE = 10;
const PREVIEW_LIMIT = 5;
const VOTE_FEEDBACK_MS = 500;
const electron = globalThis.electron as Electron;

const voteDelta = (next: boolean, previous: boolean) =>
  Number(next) - Number(previous);

const getOptimisticReplyVote = (
  reply: GameReviewAnswer,
  voteType: "upvote" | "downvote"
) => {
  let hasUpvoted = reply.hasUpvoted;
  let hasDownvoted = reply.hasDownvoted;

  if (voteType === "upvote") {
    hasUpvoted = !reply.hasUpvoted;
    hasDownvoted = hasUpvoted ? false : reply.hasDownvoted;
  }

  if (voteType === "downvote") {
    hasDownvoted = !reply.hasDownvoted;
    hasUpvoted = hasDownvoted ? false : reply.hasUpvoted;
  }

  return {
    ...reply,
    hasUpvoted,
    hasDownvoted,
    upvotes: Math.max(
      0,
      (reply.upvotes || 0) + voteDelta(hasUpvoted, reply.hasUpvoted)
    ),
    downvotes: Math.max(
      0,
      (reply.downvotes || 0) + voteDelta(hasDownvoted, reply.hasDownvoted)
    ),
  };
};

const mergeReplies = (
  existing: GameReviewAnswer[],
  incoming: GameReviewAnswer[]
) => {
  const seen = new Set(existing.map((reply) => reply.id));
  return [...existing, ...incoming.filter((reply) => !seen.has(reply.id))];
};

export function ReviewThread({
  shop,
  objectId,
  review,
  userDetailsId,
  isVisible,
  isVoting,
  previousVotes,
  onVoteReview,
  onDeleteReview,
  onToggleVisibility,
  onAnimationComplete,
  composerOpen,
  onComposerOpenChange,
}: Readonly<ReviewThreadProps>) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();

  const [replies, setReplies] = useState<GameReviewAnswer[]>(
    review.answers ?? []
  );
  const [totalCount, setTotalCount] = useState(review.answerCount ?? 0);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverLoaded, setServerLoaded] = useState(0);
  const [votingAnswers, setVotingAnswers] = useState<Set<string>>(new Set());
  const [prefill, setPrefill] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const baseUrl = `/games/${shop}/${objectId}/reviews/${review.id}/answers`;

  const displayedReplies = hidden
    ? []
    : expanded
      ? replies
      : replies.slice(0, PREVIEW_LIMIT);

  const fetchReplies = async (skip: number, replace: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        take: REPLIES_TAKE.toString(),
        skip: skip.toString(),
      });

      const response = await electron.hydraApi.get<
        { answers: GameReviewAnswer[]; totalCount: number } | undefined
      >(`${baseUrl}?${params.toString()}`, { needsAuth: false });

      const fetched = response?.answers ?? [];

      setTotalCount(response?.totalCount ?? totalCount);
      setReplies((prev) => (replace ? fetched : mergeReplies(prev, fetched)));
      setServerLoaded((prev) =>
        replace ? fetched.length : prev + fetched.length
      );
      setExpanded(true);
    } catch (error) {
      console.error("Failed to load replies:", error);
      showErrorToast(t("replies_load_failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleExpand = () => {
    if (loading) return;
    setHidden(false);
    fetchReplies(0, true);
  };

  const handleLoadMore = () => {
    if (loading) return;
    fetchReplies(serverLoaded, false);
  };

  const handleHide = () => {
    setHidden(true);
    setExpanded(false);
  };

  const handleToggleReplies = () => {
    if (loading) return;
    if (hidden) {
      handleExpand();
    } else {
      handleHide();
    }
  };

  const handleReplyTo = (displayName: string) => {
    setPrefill(displayName ? `@${displayName} ` : "");
    onComposerOpenChange(true);
  };

  const handleVoteReply = async (
    answerId: string,
    voteType: "upvote" | "downvote"
  ) => {
    if (!userDetailsId || votingAnswers.has(answerId)) return;

    const replyIndex = replies.findIndex((reply) => reply.id === answerId);
    if (replyIndex === -1) return;

    setVotingAnswers((prev) => new Set(prev).add(answerId));

    const originalReply = replies[replyIndex];
    const updatedReply = getOptimisticReplyVote(originalReply, voteType);

    setReplies((prev) =>
      prev.map((reply) => (reply.id === answerId ? updatedReply : reply))
    );

    try {
      const response = await electron.hydraApi.put<
        { upvotes: number; downvotes: number } | undefined
      >(`${baseUrl}/${answerId}/${voteType}`, { data: {} });

      if (response) {
        setReplies((prev) =>
          prev.map((reply) =>
            reply.id === answerId
              ? {
                  ...reply,
                  upvotes: response.upvotes,
                  downvotes: response.downvotes,
                }
              : reply
          )
        );
      }
    } catch (error) {
      console.error(`Failed to ${voteType} reply:`, error);
      setReplies((prev) =>
        prev.map((reply) => (reply.id === answerId ? originalReply : reply))
      );
      showErrorToast(t("vote_failed"));
    } finally {
      setTimeout(() => {
        setVotingAnswers((prev) => {
          const next = new Set(prev);
          next.delete(answerId);
          return next;
        });
      }, VOTE_FEEDBACK_MS);
    }
  };

  const handleDeleteReply = async (answerId: string) => {
    try {
      await electron.hydraApi.delete(`${baseUrl}/${answerId}`);
      setReplies((prev) => prev.filter((reply) => reply.id !== answerId));
      setTotalCount((prev) => Math.max(0, prev - 1));
      setServerLoaded((prev) => Math.max(0, prev - 1));
      showSuccessToast(t("reply_deleted_successfully"));
    } catch (error) {
      console.error("Failed to delete reply:", error);
      showErrorToast(t("reply_deletion_failed"));
    }
  };

  const handlePostReply = async (answerHtml: string) => {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = answerHtml;
    const text = tempDiv.textContent?.trim() || "";

    if (!text) {
      showErrorToast(t("reply_cannot_be_empty"));
      return;
    }

    if (submitting) return;

    setSubmitting(true);

    try {
      const response = await electron.hydraApi.post<
        GameReviewAnswer | undefined
      >(`${baseUrl}`, {
        data: { answerHtml },
      });

      if (response) {
        setReplies((prev) => mergeReplies(prev, [response]));
        setTotalCount((prev) => prev + 1);
        setHidden(false);
        setExpanded(true);
      }

      onComposerOpenChange(false);
      setPrefill("");
      showSuccessToast(t("reply_submitted_successfully"));
    } catch (error) {
      console.error("Failed to submit reply:", error);
      showErrorToast(t("reply_submission_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const blockedCollapsed = review.isBlocked && !isVisible;
  const hasReplies = replies.length > 0;
  const effectiveTotal = Math.max(totalCount, replies.length);

  const canViewAll =
    !expanded && hasReplies && displayedReplies.length < effectiveTotal;
  const canLoadMore = !hidden && expanded && replies.length < totalCount;
  const showHide = !hidden && hasReplies;

  const showInlineReply =
    Boolean(userDetailsId) && !blockedCollapsed && !composerOpen;

  const showThreadActions = canViewAll || canLoadMore || showHide;

  const showRepliesSection = !blockedCollapsed && (hasReplies || composerOpen);

  return (
    <div className="game-details__review-thread">
      <ReviewItem
        review={review}
        userDetailsId={userDetailsId}
        isBlocked={review.isBlocked}
        isVisible={isVisible}
        isVoting={isVoting}
        previousVotes={previousVotes}
        onVote={onVoteReview}
        onDelete={onDeleteReview}
        onToggleVisibility={onToggleVisibility}
        onAnimationComplete={onAnimationComplete}
        replyAction={
          showInlineReply ? (
            <button
              className="game-details__reply-action-link"
              onClick={() => handleReplyTo("")}
              title={t("reply")}
            >
              <ReplyIcon size={14} />
              <span>{t("reply")}</span>
            </button>
          ) : undefined
        }
      />

      {showRepliesSection && (
        <div className="game-details__review-replies">
          {hasReplies && (
            <button
              type="button"
              className="game-details__reply-thread-line"
              onClick={handleToggleReplies}
              disabled={loading}
              aria-label={
                hidden
                  ? t("view_all_replies", { count: effectiveTotal })
                  : t("hide_replies")
              }
            />
          )}
          {hasReplies && (
            <div className="game-details__reply-thread">
              {displayedReplies.map((reply) => (
                <ReviewReplyItem
                  key={reply.id}
                  reply={reply}
                  userDetailsId={userDetailsId}
                  isVoting={votingAnswers.has(reply.id)}
                  onVote={handleVoteReply}
                  onDelete={handleDeleteReply}
                />
              ))}
            </div>
          )}

          {showThreadActions && (
            <div className="game-details__reply-thread-actions">
              {canViewAll && (
                <button
                  className="game-details__reply-toggle"
                  onClick={handleExpand}
                  disabled={loading}
                >
                  {loading
                    ? t("loading_replies")
                    : t("view_all_replies", { count: effectiveTotal })}
                </button>
              )}
              {canLoadMore && (
                <button
                  className="game-details__reply-toggle"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  {loading ? t("loading_replies") : t("load_more_replies")}
                </button>
              )}
              {showHide && (
                <button
                  className="game-details__reply-toggle"
                  onClick={handleHide}
                >
                  {t("hide_replies")}
                </button>
              )}
            </div>
          )}

          {composerOpen && userDetailsId && (
            <ReviewReplyComposer
              key={prefill}
              prefill={prefill}
              submitting={submitting}
              onSubmit={handlePostReply}
              onCancel={() => {
                onComposerOpenChange(false);
                setPrefill("");
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
