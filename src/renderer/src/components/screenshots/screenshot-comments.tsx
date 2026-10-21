import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CommentDiscussionIcon,
  CommentIcon,
  PencilIcon,
  ReportIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Tooltip } from "react-tooltip";
import cn from "classnames";

import { Avatar } from "../avatar/avatar";
import { Button } from "../button/button";
import { ConfirmationModal } from "../confirmation-modal/confirmation-modal";
import { Link } from "../link/link";
import { RichTextContent } from "../rich-text-content/rich-text-content";
import { useDate, useUserDetails } from "@renderer/hooks";
import { AuthPage } from "@shared";
import type {
  ProfileScreenshot,
  ScreenshotComment,
  ScreenshotCommentVoteType,
} from "@types";

import { ScreenshotCommentInput } from "./screenshot-comment-input";
import { ScreenshotCommentReportModal } from "./screenshot-report-modal";
import type { ScreenshotFailure } from "./use-screenshot-actions";
import type { ScreenshotPatch } from "@shared";
import { useScreenshotComments } from "./use-screenshot-comments";

type ComposerState =
  | "ready"
  | "signed_out"
  | "turned_off"
  | "unavailable"
  | "not_allowed";

const getComposerState = (
  screenshot: ProfileScreenshot,
  isSignedIn: boolean
): ComposerState => {
  const isApproved =
    !screenshot.moderationStatus || screenshot.moderationStatus === "APPROVED";
  if (!isApproved) return "unavailable";
  if (!screenshot.commentsEnabled) return "turned_off";
  if (!isSignedIn) return "signed_out";
  if (!screenshot.canComment) return "not_allowed";
  return "ready";
};

const COMPOSER_NOTICE_KEYS: Record<Exclude<ComposerState, "ready">, string> = {
  signed_out: "comments_sign_in_hint",
  turned_off: "comments_turned_off",
  unavailable: "comments_unavailable",
  not_allowed: "comments_not_allowed",
};

interface ScreenshotCommentItemProps {
  comment: ScreenshotComment;
  isSignedIn: boolean;
  isPending: boolean;
  isReported: boolean;
  isEditing: boolean;
  onAuthorClick: () => void;
  onVote: (comment: ScreenshotComment, vote: ScreenshotCommentVoteType) => void;
  onStartEdit: (comment: ScreenshotComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: (comment: ScreenshotComment, body: string) => Promise<boolean>;
  onRequestDelete: (comment: ScreenshotComment) => void;
  onRequestReport: (comment: ScreenshotComment) => void;
  tooltipId: string;
}

function ScreenshotCommentItem({
  comment,
  isSignedIn,
  isPending,
  isReported,
  isEditing,
  onAuthorClick,
  onVote,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRequestDelete,
  onRequestReport,
  tooltipId,
}: Readonly<ScreenshotCommentItemProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDistance, formatDateTime } = useDate();
  const canVote = !comment.isOwn;
  const voteTitle = (key: string) => {
    if (!canVote) return t("cannot_vote_own_comment");
    if (!isSignedIn) return t("sign_in_to_vote");
    return t(key);
  };

  const handleVote = (vote: ScreenshotCommentVoteType) => {
    if (!isSignedIn) {
      void window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    onVote(comment, vote);
  };

  return (
    <li
      className={cn("screenshot-comments__item", {
        "screenshot-comments__item--hidden": comment.isHidden,
      })}
    >
      <Link
        className="screenshot-comments__avatar"
        to={`/profile/${encodeURIComponent(comment.author.id)}`}
        onClick={onAuthorClick}
        aria-label={comment.author.displayName}
      >
        <Avatar size={32} src={comment.author.profileImageUrl} alt="" />
      </Link>

      <div className="screenshot-comments__body">
        <div className="screenshot-comments__meta">
          <Link
            className="screenshot-comments__author"
            to={`/profile/${encodeURIComponent(comment.author.id)}`}
            onClick={onAuthorClick}
          >
            {comment.author.displayName}
          </Link>
          <time
            className="screenshot-comments__time"
            dateTime={new Date(comment.createdAt).toISOString()}
            title={formatDateTime(comment.createdAt)}
          >
            {formatDistance(new Date(comment.createdAt), new Date(), {
              addSuffix: true,
            })}
          </time>
          {comment.editedAt ? (
            <span
              className="screenshot-comments__edited"
              title={formatDateTime(comment.editedAt)}
            >
              {t("comment_edited")}
            </span>
          ) : null}
        </div>

        {comment.isHidden ? (
          <p className="screenshot-comments__hidden-notice">
            {t("comment_hidden_notice")}
          </p>
        ) : null}

        {isEditing ? (
          <ScreenshotCommentInput
            initialValue={comment.bodyHtml}
            placeholder={t("edit_comment_placeholder")}
            submitLabel={t("save")}
            isSubmitting={isPending}
            focusOnMount
            onSubmit={async (body) => {
              const wasSaved = await onSaveEdit(comment, body);
              if (wasSaved) onCancelEdit();
              return wasSaved;
            }}
            onCancel={onCancelEdit}
          />
        ) : (
          <RichTextContent
            html={comment.bodyHtml}
            className="screenshot-comments__text"
          />
        )}

        {isEditing ? null : (
          <div className="screenshot-comments__actions">
            <div className="screenshot-comments__votes">
              <button
                type="button"
                className={cn(
                  "screenshot-comments__vote screenshot-comments__vote--upvote",
                  {
                    "screenshot-comments__vote--active":
                      comment.myVote === "UPVOTE",
                  }
                )}
                onClick={() => handleVote("UPVOTE")}
                disabled={!canVote || isPending}
                aria-pressed={comment.myVote === "UPVOTE"}
                aria-label={t("upvote_comment")}
                data-tooltip-id={tooltipId}
                data-tooltip-content={voteTitle("upvote_comment")}
              >
                <ThumbsUp size={16} />
                <span>{comment.upvotes}</span>
              </button>
              <button
                type="button"
                className={cn(
                  "screenshot-comments__vote screenshot-comments__vote--downvote",
                  {
                    "screenshot-comments__vote--active":
                      comment.myVote === "DOWNVOTE",
                  }
                )}
                onClick={() => handleVote("DOWNVOTE")}
                disabled={!canVote || isPending}
                aria-pressed={comment.myVote === "DOWNVOTE"}
                aria-label={t("downvote_comment")}
                data-tooltip-id={tooltipId}
                data-tooltip-content={voteTitle("downvote_comment")}
              >
                <ThumbsDown size={16} />
                <span>{comment.downvotes}</span>
              </button>
            </div>

            <div className="screenshot-comments__tools">
              {comment.isOwn ? (
                <Button
                  theme="outline"
                  size="small"
                  className="screenshot-comments__tool screenshot-comments__edit"
                  onClick={() => onStartEdit(comment)}
                  disabled={isPending}
                  aria-label={t("edit_comment")}
                  data-tooltip-id={tooltipId}
                  data-tooltip-content={t("edit_comment")}
                >
                  <PencilIcon size={14} />
                </Button>
              ) : null}

              {comment.canDelete ? (
                <Button
                  theme="danger"
                  size="small"
                  className="screenshot-comments__tool screenshot-comments__delete"
                  onClick={() => onRequestDelete(comment)}
                  disabled={isPending}
                  aria-label={t("delete_comment")}
                  data-tooltip-id={tooltipId}
                  data-tooltip-content={t("delete_comment")}
                >
                  <TrashIcon size={14} />
                </Button>
              ) : null}

              {!comment.isOwn && isSignedIn ? (
                <Button
                  theme="outline"
                  size="small"
                  className="screenshot-comments__tool screenshot-comments__report"
                  onClick={() => onRequestReport(comment)}
                  disabled={isPending || isReported}
                  aria-label={t(isReported ? "reported" : "report_comment")}
                  data-tooltip-id={tooltipId}
                  data-tooltip-content={t(
                    isReported ? "reported" : "report_comment"
                  )}
                >
                  <ReportIcon size={14} />
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

interface ScreenshotCommentsProps {
  screenshot: ProfileScreenshot;
  onPatch: (screenshotId: string, patch: ScreenshotPatch) => void;
  onFailure: (screenshotId: string, failure: ScreenshotFailure) => void;
  onNavigateAway: () => void;
}

export function ScreenshotComments({
  screenshot,
  onPatch,
  onFailure,
  onNavigateAway,
}: Readonly<ScreenshotCommentsProps>) {
  const { t } = useTranslation("screenshots");
  const { userDetails } = useUserDetails();
  const tooltipId = useId();
  const isSignedIn = Boolean(userDetails);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScreenshotComment | null>(
    null
  );
  const [reportTarget, setReportTarget] = useState<ScreenshotComment | null>(
    null
  );
  const {
    comments,
    total,
    hasMore,
    isLoading,
    hasFailed,
    isSubmitting,
    pendingCommentIds,
    reportedCommentIds,
    reload,
    loadMore,
    createComment,
    editComment,
    deleteComment,
    voteComment,
    reportComment,
  } = useScreenshotComments({
    screenshot,
    isEnabled: true,
    isSignedIn,
    onPatch,
    onFailure,
  });

  const composerState = getComposerState(screenshot, isSignedIn);
  const commentCount = total ?? screenshot.commentCount;
  const isInitialLoading = isLoading && comments.length === 0;

  const renderList = () => {
    if (hasFailed) {
      return (
        <output className="screenshot-comments__empty">
          <p>{t("comments_load_failed")}</p>
          <Button theme="outline" onClick={() => void reload()}>
            {t("retry")}
          </Button>
        </output>
      );
    }

    if (isInitialLoading) {
      return (
        <output className="screenshot-comments__empty">
          {t("loading_comments")}
        </output>
      );
    }

    if (comments.length === 0) {
      return (
        <div className="screenshot-comments__empty-state">
          <span className="screenshot-comments__empty-state-icon">
            <CommentDiscussionIcon size={24} />
          </span>
          <p className="screenshot-comments__empty-state-title">
            {t("no_comments")}
          </p>
        </div>
      );
    }

    return (
      <>
        <ul className="screenshot-comments__list">
          {comments.map((comment) => (
            <ScreenshotCommentItem
              key={comment.id}
              comment={comment}
              isSignedIn={isSignedIn}
              isPending={pendingCommentIds.has(comment.id)}
              isReported={reportedCommentIds.has(comment.id)}
              isEditing={editingCommentId === comment.id}
              onAuthorClick={onNavigateAway}
              onVote={(item, vote) => void voteComment(item, vote)}
              onStartEdit={(item) => setEditingCommentId(item.id)}
              onCancelEdit={() => setEditingCommentId(null)}
              onSaveEdit={editComment}
              onRequestDelete={setDeleteTarget}
              onRequestReport={setReportTarget}
              tooltipId={tooltipId}
            />
          ))}
        </ul>

        {hasMore ? (
          <Button
            theme="outline"
            className="screenshot-comments__load-more"
            disabled={isLoading}
            onClick={() => void loadMore()}
          >
            {isLoading ? t("loading_comments") : t("load_more_comments")}
          </Button>
        ) : null}
      </>
    );
  };

  return (
    <section className="screenshot-comments" aria-label={t("comments")}>
      {commentCount > 0 ? (
        <h3 className="screenshot-lightbox__section-title">
          <CommentIcon size={16} />
          {t("comments_title", { count: commentCount })}
        </h3>
      ) : null}

      <div className="screenshot-comments__feed">{renderList()}</div>

      <div className="screenshot-comments__composer">
        {composerState === "ready" ? (
          <ScreenshotCommentInput
            placeholder={t("comment_placeholder")}
            submitLabel={t("post_comment")}
            isSubmitting={isSubmitting}
            onSubmit={createComment}
          />
        ) : (
          <div className="screenshot-comments__notice" role="note">
            <span>{t(COMPOSER_NOTICE_KEYS[composerState])}</span>
            {composerState === "signed_out" ? (
              <Button
                theme="outline"
                onClick={() =>
                  void window.electron.openAuthWindow(AuthPage.SignIn)
                }
              >
                {t("sign_in")}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <Tooltip
        id={tooltipId}
        place="top"
        positionStrategy="fixed"
        className="screenshot-lightbox__tooltip"
      />

      <ConfirmationModal
        visible={Boolean(deleteTarget)}
        title={t("delete_comment_title")}
        descriptionText={t("delete_comment_description")}
        confirmButtonLabel={t("delete")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        onConfirm={() => {
          if (!deleteTarget) return;
          void deleteComment(deleteTarget).then((wasDeleted) => {
            if (wasDeleted) setDeleteTarget(null);
          });
        }}
        onClose={() => setDeleteTarget(null)}
      />

      <ScreenshotCommentReportModal
        visible={Boolean(reportTarget)}
        isSubmitting={Boolean(
          reportTarget && pendingCommentIds.has(reportTarget.id)
        )}
        onClose={() => setReportTarget(null)}
        onSubmit={(values) =>
          reportTarget
            ? reportComment(reportTarget, values)
            : Promise.resolve(false)
        }
      />
    </section>
  );
}
