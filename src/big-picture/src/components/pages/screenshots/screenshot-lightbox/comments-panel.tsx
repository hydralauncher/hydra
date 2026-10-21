import {
  ArrowFatDownIcon,
  ArrowFatUpIcon,
  ChatCircleIcon,
  ChatsCircleIcon,
  DotsThreeVerticalIcon,
  FlagIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ProfileScreenshot,
  ScreenshotComment,
  ScreenshotCommentsResponse,
  ScreenshotCommentVoteResponse,
  ScreenshotCommentVoteType,
  ScreenshotReportValues,
} from "@types";
import {
  AuthPage,
  SCREENSHOT_COMMENT_REPORT_REASONS,
  buildUserScreenshotCommentPath,
  buildUserScreenshotCommentReportPath,
  buildUserScreenshotCommentVotePath,
  buildUserScreenshotCommentsPath,
  mergeScreenshotPages,
  normalizeScreenshotCommentBody,
  normalizeScreenshotReportValues,
  getScreenshotApiErrorCode,
} from "@shared";
import { logger } from "@renderer/logger";

import {
  Button,
  ContextMenu,
  FocusItem,
  HorizontalFocusGroup,
  UserProfileAvatar,
  VerticalFocusGroup,
  type ContextMenuItem,
} from "../../../common";
import { ConfirmationModal } from "../../../modals";
import { formatRelativeDate } from "../../../../helpers";
import { useBigPictureToast, useNavigation } from "../../../../hooks";
import type { FocusOverrides, FocusOverrideTarget } from "../../../../services";
import { getScreenshotErrorKey } from "../helpers";
import { ScreenshotReportModal } from "../screenshot-report-modal";
import { ScreenshotCommentBody } from "./comment-body";
import { ScreenshotDialogPresence } from "../screenshot-dialog-presence";
import { CommentComposer } from "./comment-composer";
import {
  getCommentFocusIds,
  getScreenshotCommentsPanelFocusIds,
} from "./comment-focus-ids";
import {
  applyCommentWrites,
  type ScreenshotCommentWrite,
  type ScreenshotCommentWriteInput,
} from "./comment-writes";

type CommentsStatus = "idle" | "loading" | "ready" | "error";

interface CommentMenuState {
  comment: ScreenshotComment;
  position: { x: number; y: number };
}

interface ScreenshotCommentsPanelProps {
  screenshot: ProfileScreenshot;
  viewerId: string | null;
  isOwner: boolean;
  leftTarget: FocusOverrideTarget;
  onCommentCountChange: (screenshotId: string, delta: number) => void;
}

function useScreenshotComments(
  screenshot: ProfileScreenshot,
  isAvailable: boolean,
  needsAuth: boolean
) {
  const [comments, setComments] = useState<ScreenshotComment[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<CommentsStatus>("idle");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const generationRef = useRef(0);
  const writeVersionRef = useRef(0);
  const writesRef = useRef<ScreenshotCommentWrite[]>([]);
  const pendingReadsRef = useRef(0);
  const ownerId = screenshot.owner.id;
  const screenshotId = screenshot.id;

  const beginRead = () => {
    pendingReadsRef.current += 1;
    return writeVersionRef.current;
  };

  const endRead = () => {
    pendingReadsRef.current = Math.max(0, pendingReadsRef.current - 1);
    if (pendingReadsRef.current === 0) writesRef.current = [];
  };

  const fetchFirstPage = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const sinceVersion = beginRead();

    try {
      const response =
        await globalThis.window.electron.hydraApi.get<ScreenshotCommentsResponse>(
          buildUserScreenshotCommentsPath(ownerId, screenshotId),
          { needsAuth }
        );

      if (generationRef.current !== generation) return;

      const merged = applyCommentWrites(
        response?.items ?? [],
        writesRef.current,
        sinceVersion,
        true
      );
      setComments(merged.comments);
      setTotal(Math.max(0, (response?.total ?? 0) + merged.netCountDelta));
      setNextCursor(response?.nextCursor ?? null);
      setStatus("ready");
    } catch (error) {
      if (generationRef.current !== generation) return;

      logger.error("Failed to load screenshot comments", error);
      setStatus("error");
    } finally {
      if (generationRef.current === generation) endRead();
    }
  }, [needsAuth, ownerId, screenshotId]);

  useEffect(() => {
    generationRef.current += 1;
    pendingReadsRef.current = 0;
    writesRef.current = [];
    setComments([]);
    setTotal(0);
    setNextCursor(null);
    setIsLoadingMore(false);

    if (!isAvailable) {
      setStatus("ready");
      return;
    }

    setStatus("loading");
    void fetchFirstPage();
  }, [fetchFirstPage, isAvailable]);

  const recordWrite = useCallback((write: ScreenshotCommentWriteInput) => {
    writeVersionRef.current += 1;
    if (pendingReadsRef.current === 0) return;

    writesRef.current.push({ ...write, version: writeVersionRef.current });
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;

    const generation = generationRef.current;
    const sinceVersion = beginRead();
    setIsLoadingMore(true);

    try {
      const response =
        await globalThis.window.electron.hydraApi.get<ScreenshotCommentsResponse>(
          buildUserScreenshotCommentsPath(ownerId, screenshotId, {
            cursor: nextCursor,
          }),
          { needsAuth }
        );

      if (generationRef.current !== generation) return;

      const merged = applyCommentWrites(
        response?.items ?? [],
        writesRef.current,
        sinceVersion,
        false
      );
      setComments((current) => mergeScreenshotPages(current, merged.comments));
      setTotal((current) =>
        merged.hasLaterWrites ? current : (response?.total ?? current)
      );
      setNextCursor(response?.nextCursor ?? null);
    } catch (error) {
      logger.error("Failed to load more screenshot comments", error);
    } finally {
      if (generationRef.current === generation) {
        endRead();
        setIsLoadingMore(false);
      }
    }
  }, [isLoadingMore, needsAuth, nextCursor, ownerId, screenshotId]);

  return {
    comments,
    total,
    status,
    hasMore: Boolean(nextCursor),
    isLoadingMore,
    loadMore,
    recordWrite,
    setComments,
    setTotal,
  };
}

interface CommentItemProps {
  comment: ScreenshotComment;
  isSignedIn: boolean;
  hasMenu: boolean;
  isVoting: boolean;
  language: string;
  leftTarget: FocusOverrideTarget;
  onVote: (comment: ScreenshotComment, vote: ScreenshotCommentVoteType) => void;
  onOpenMenu: (comment: ScreenshotComment, element: HTMLElement) => void;
}

interface CommentVoteButtonProps {
  focusId: string;
  voteType: ScreenshotCommentVoteType;
  count: number;
  isActive: boolean;
  isFocusable: boolean;
  isDisabled: boolean;
  label: string;
  navigationOverrides?: FocusOverrides;
  onVote: () => void;
}

function CommentVoteButton({
  focusId,
  voteType,
  count,
  isActive,
  isFocusable,
  isDisabled,
  label,
  navigationOverrides,
  onVote,
}: Readonly<CommentVoteButtonProps>) {
  const Icon = voteType === "UPVOTE" ? ArrowFatUpIcon : ArrowFatDownIcon;

  return (
    <FocusItem
      id={focusId}
      navigationState={isFocusable ? "active" : "disabled"}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <button
        type="button"
        className={cn("screenshot-comments__vote", {
          "screenshot-comments__vote--active": isActive,
        })}
        disabled={!isFocusable || isDisabled}
        aria-label={label}
        aria-pressed={isActive}
        title={label}
        onClick={onVote}
      >
        <Icon size={18} weight={isActive ? "fill" : "regular"} />
        <span>{count}</span>
      </button>
    </FocusItem>
  );
}

function CommentItem({
  comment,
  isSignedIn,
  hasMenu,
  isVoting,
  language,
  leftTarget,
  onVote,
  onOpenMenu,
}: Readonly<CommentItemProps>) {
  const { t } = useTranslation("big_picture");
  const focusIds = getCommentFocusIds(comment.id);
  const moreButtonRef = useRef<HTMLDivElement | null>(null);
  const canVote = !comment.isOwn;

  return (
    <li className="screenshot-comments__item">
      <div className="screenshot-comments__item-header">
        <UserProfileAvatar
          image={comment.author.profileImageUrl}
          alt=""
          className="screenshot-comments__avatar"
          fallbackClassName="screenshot-comments__avatar--fallback"
          width={28}
          height={28}
          iconSize={14}
        />
        <div className="screenshot-comments__item-heading">
          <span className="screenshot-comments__author">
            {comment.author.displayName}
          </span>
          <span className="screenshot-comments__time">
            {formatRelativeDate(comment.createdAt, { locale: language })}
            {comment.editedAt ? ` · ${t("screenshots_comment_edited")}` : ""}
          </span>
        </div>
      </div>

      {comment.isHidden ? (
        <p className="screenshot-comments__hidden-notice">
          {t("screenshots_comment_hidden")}
        </p>
      ) : null}

      <ScreenshotCommentBody
        bodyHtml={comment.bodyHtml}
        className={cn({
          "screenshot-comments__body--hidden": comment.isHidden,
        })}
      />

      <HorizontalFocusGroup regionId={focusIds.region} asChild>
        <div className="screenshot-comments__item-actions">
          <div className="screenshot-comments__votes">
            <CommentVoteButton
              focusId={focusIds.upvote}
              voteType="UPVOTE"
              count={comment.upvotes}
              isActive={comment.myVote === "UPVOTE"}
              isFocusable={canVote}
              isDisabled={isVoting}
              label={t(
                isSignedIn
                  ? "screenshots_comment_upvote"
                  : "screenshots_sign_in_to_vote"
              )}
              navigationOverrides={{ left: leftTarget }}
              onVote={() => onVote(comment, "UPVOTE")}
            />
            <CommentVoteButton
              focusId={focusIds.downvote}
              voteType="DOWNVOTE"
              count={comment.downvotes}
              isActive={comment.myVote === "DOWNVOTE"}
              isFocusable={canVote}
              isDisabled={isVoting}
              label={t(
                isSignedIn
                  ? "screenshots_comment_downvote"
                  : "screenshots_sign_in_to_vote"
              )}
              onVote={() => onVote(comment, "DOWNVOTE")}
            />
          </div>
          {hasMenu ? (
            <div ref={moreButtonRef} className="screenshot-comments__more">
              <Button
                variant="secondary"
                size="icon"
                focusId={focusIds.more}
                className="screenshot-comments__icon-action"
                icon={<DotsThreeVerticalIcon size={18} weight="bold" />}
                aria-label={t("screenshots_comment_options")}
                title={t("screenshots_comment_options")}
                focusNavigationOverrides={
                  canVote
                    ? { right: { type: "block" } }
                    : { left: leftTarget, right: { type: "block" } }
                }
                onClick={() => {
                  if (moreButtonRef.current)
                    onOpenMenu(comment, moreButtonRef.current);
                }}
              >
                {null}
              </Button>
            </div>
          ) : null}
        </div>
      </HorizontalFocusGroup>
    </li>
  );
}

interface CommentsListStatusProps {
  status: CommentsStatus;
  isEmpty: boolean;
}

function CommentsListStatus({
  status,
  isEmpty,
}: Readonly<CommentsListStatusProps>) {
  const { t } = useTranslation("big_picture");

  if (status === "loading") {
    return (
      <p className="screenshot-comments__status">
        {t("screenshots_comments_loading")}
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="screenshot-comments__status">
        {t("screenshots_comments_load_failed")}
      </p>
    );
  }

  if (status !== "ready" || !isEmpty) return null;

  return (
    <div className="screenshot-comments__empty">
      <span className="screenshot-comments__empty-icon">
        <ChatsCircleIcon size={28} />
      </span>
      <p>{t("screenshots_comments_empty")}</p>
    </div>
  );
}

export function ScreenshotCommentsPanel({
  screenshot,
  viewerId,
  isOwner,
  leftTarget,
  onCommentCountChange,
}: Readonly<ScreenshotCommentsPanelProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const { setFocus } = useNavigation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const focusIds = getScreenshotCommentsPanelFocusIds(screenshot.id);
  const isAvailable =
    screenshot.moderationStatus === undefined ||
    screenshot.moderationStatus === "APPROVED";
  const {
    comments,
    total,
    status,
    hasMore,
    isLoadingMore,
    loadMore,
    recordWrite,
    setComments,
    setTotal,
  } = useScreenshotComments(screenshot, isAvailable, Boolean(viewerId));
  const [editingComment, setEditingComment] =
    useState<ScreenshotComment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [votingIds, setVotingIds] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<CommentMenuState | null>(null);
  const [deletingComment, setDeletingComment] =
    useState<ScreenshotComment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [reportingComment, setReportingComment] =
    useState<ScreenshotComment | null>(null);
  const [isReporting, setIsReporting] = useState(false);
  const ownerId = screenshot.owner.id;

  useEffect(() => {
    setEditingComment(null);
    setMenu(null);
  }, [screenshot.id]);

  const showError = useCallback(
    (error: unknown) => {
      showErrorToast(
        t(getScreenshotErrorKey(getScreenshotApiErrorCode(error))),
        {
          fallbackVisual: "settings",
        }
      );
    },
    [showErrorToast, t]
  );

  const replaceComment = useCallback(
    (commentId: string, update: Partial<ScreenshotComment>) => {
      recordWrite({ kind: "patch", commentId, patch: update });
      setComments((current) =>
        current.map((comment) =>
          comment.id === commentId ? { ...comment, ...update } : comment
        )
      );
    },
    [recordWrite, setComments]
  );

  const submit = useCallback(
    async (html: string) => {
      const bodyHtml = normalizeScreenshotCommentBody(html);
      if (!bodyHtml || isSubmitting) return false;

      setIsSubmitting(true);

      try {
        if (editingComment) {
          const updated =
            await globalThis.window.electron.hydraApi.patch<ScreenshotComment>(
              buildUserScreenshotCommentPath(
                ownerId,
                screenshot.id,
                editingComment.id
              ),
              { data: { bodyHtml }, needsAuth: true }
            );
          replaceComment(
            editingComment.id,
            updated ?? { bodyHtml, editedAt: Date.now() }
          );
          setEditingComment(null);
          return true;
        }

        const created =
          await globalThis.window.electron.hydraApi.post<ScreenshotComment>(
            buildUserScreenshotCommentsPath(ownerId, screenshot.id),
            { data: { bodyHtml }, needsAuth: true }
          );
        if (created) {
          recordWrite({ kind: "add", comment: created });
          setComments((current) => [created, ...current]);
          setTotal((current) => current + 1);
          onCommentCountChange(screenshot.id, 1);
        }
        return true;
      } catch (error) {
        showError(error);
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      editingComment,
      recordWrite,
      isSubmitting,
      onCommentCountChange,
      ownerId,
      replaceComment,
      screenshot.id,
      setComments,
      setTotal,
      showError,
    ]
  );

  const vote = useCallback(
    async (comment: ScreenshotComment, voteType: ScreenshotCommentVoteType) => {
      if (!viewerId) {
        void globalThis.window.electron.openAuthWindow(AuthPage.SignIn);
        return;
      }
      if (comment.isOwn || votingIds.has(comment.id)) return;

      setVotingIds((current) => new Set(current).add(comment.id));

      try {
        const response =
          await globalThis.window.electron.hydraApi.put<ScreenshotCommentVoteResponse>(
            buildUserScreenshotCommentVotePath(
              ownerId,
              screenshot.id,
              comment.id,
              voteType
            ),
            { needsAuth: true }
          );
        if (response) replaceComment(comment.id, response);
      } catch (error) {
        showError(error);
      } finally {
        setVotingIds((current) => {
          const next = new Set(current);
          next.delete(comment.id);
          return next;
        });
      }
    },
    [ownerId, replaceComment, screenshot.id, showError, viewerId, votingIds]
  );

  const confirmDelete = useCallback(async () => {
    if (!deletingComment) return;

    setIsDeleting(true);

    try {
      await globalThis.window.electron.hydraApi.delete(
        buildUserScreenshotCommentPath(
          ownerId,
          screenshot.id,
          deletingComment.id
        ),
        { needsAuth: true }
      );
      recordWrite({
        kind: "remove",
        commentId: deletingComment.id,
        wasCounted: !deletingComment.isHidden,
      });
      setComments((current) =>
        current.filter((comment) => comment.id !== deletingComment.id)
      );
      setTotal((current) => Math.max(0, current - 1));
      if (!deletingComment.isHidden) onCommentCountChange(screenshot.id, -1);
      if (editingComment?.id === deletingComment.id) setEditingComment(null);
      setDeletingComment(null);
      showSuccessToast(t("screenshots_comment_deleted"), {
        fallbackVisual: "settings",
      });
      globalThis.window.requestAnimationFrame(() => {
        setFocus(viewerId ? focusIds.input : focusIds.signIn);
      });
    } catch (error) {
      showError(error);
    } finally {
      setIsDeleting(false);
    }
  }, [
    deletingComment,
    editingComment,
    recordWrite,
    focusIds.input,
    focusIds.signIn,
    onCommentCountChange,
    ownerId,
    screenshot.id,
    setComments,
    setFocus,
    setTotal,
    showError,
    showSuccessToast,
    t,
    viewerId,
  ]);

  const submitReport = useCallback(
    async (values: ScreenshotReportValues) => {
      if (!reportingComment) return false;

      setIsReporting(true);

      try {
        await globalThis.window.electron.hydraApi.post(
          buildUserScreenshotCommentReportPath(
            ownerId,
            screenshot.id,
            reportingComment.id
          ),
          { data: normalizeScreenshotReportValues(values), needsAuth: true }
        );
        showSuccessToast(t("screenshots_comment_reported"), {
          fallbackVisual: "settings",
        });
        return true;
      } catch (error) {
        const code = getScreenshotApiErrorCode(error);
        showError(error);
        return code === "screenshots/already-reported";
      } finally {
        setIsReporting(false);
      }
    },
    [ownerId, reportingComment, screenshot.id, showError, showSuccessToast, t]
  );

  const startEditing = (comment: ScreenshotComment) => {
    setEditingComment(comment);
    globalThis.window.requestAnimationFrame(() => {
      setFocus(focusIds.input);
    });
  };
  const startEditingRef = useRef(startEditing);
  startEditingRef.current = startEditing;

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return [];

    const { comment } = menu;
    const items: ContextMenuItem[] = [];

    if (comment.isOwn && screenshot.canComment) {
      items.push({
        id: "edit",
        label: t("screenshots_comment_edit"),
        icon: <PencilSimpleIcon size={18} />,
        restoreFocusOnClose: false,
        onSelect: () => startEditingRef.current(comment),
      });
    }

    if (comment.canDelete) {
      items.push({
        id: "delete",
        label: t("screenshots_comment_delete"),
        icon: <TrashIcon size={18} />,
        danger: true,
        onSelect: () => setDeletingComment(comment),
      });
    }

    if (!comment.isOwn && viewerId) {
      items.push({
        id: "report",
        label: t("screenshots_comment_report"),
        icon: <FlagIcon size={18} />,
        onSelect: () => setReportingComment(comment),
      });
    }

    return items;
  }, [menu, screenshot.canComment, t, viewerId]);

  const hasMenu = (comment: ScreenshotComment) =>
    (comment.isOwn && screenshot.canComment) ||
    comment.canDelete ||
    (!comment.isOwn && Boolean(viewerId));

  return (
    <VerticalFocusGroup regionId={focusIds.region} asChild>
      <aside className="screenshot-comments">
        <header className="screenshot-comments__header">
          <h2>{t("screenshots_comments_title")}</h2>
          <span className="screenshot-comments__count">
            <ChatCircleIcon size={14} weight="bold" />
            {total}
          </span>
        </header>

        <div className="screenshot-comments__scroll">
          <CommentsListStatus status={status} isEmpty={comments.length === 0} />

          {comments.length > 0 ? (
            <ul className="screenshot-comments__list">
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  isSignedIn={Boolean(viewerId)}
                  hasMenu={hasMenu(comment)}
                  isVoting={votingIds.has(comment.id)}
                  language={language}
                  leftTarget={leftTarget}
                  onVote={(target, voteType) => void vote(target, voteType)}
                  onOpenMenu={(target, element) => {
                    const rect = element.getBoundingClientRect();
                    setMenu({
                      comment: target,
                      position: { x: rect.left - 200, y: rect.bottom + 8 },
                    });
                  }}
                />
              ))}
            </ul>
          ) : null}

          {hasMore ? (
            <FocusItem
              id={focusIds.loadMore}
              navigationOverrides={{ left: leftTarget }}
              asChild
            >
              <button
                type="button"
                className="screenshot-comments__load-more"
                disabled={isLoadingMore}
                onClick={() => void loadMore()}
              >
                {t(
                  isLoadingMore
                    ? "screenshots_comments_loading"
                    : "screenshots_comments_load_more"
                )}
              </button>
            </FocusItem>
          ) : null}
        </div>

        <CommentComposer
          screenshot={screenshot}
          viewerId={viewerId}
          isOwner={isOwner}
          focusIds={focusIds}
          leftTarget={leftTarget}
          editingComment={editingComment}
          isSubmitting={isSubmitting}
          onSubmit={submit}
          onCancelEdit={() => setEditingComment(null)}
        />

        <ContextMenu
          items={menuItems}
          visible={Boolean(menu)}
          position={menu?.position ?? { x: 0, y: 0 }}
          restoreFocusId={
            menu ? getCommentFocusIds(menu.comment.id).more : null
          }
          ariaLabel={t("screenshots_comment_options")}
          onClose={() => setMenu(null)}
        />

        <ScreenshotDialogPresence isOpen={Boolean(deletingComment)} />
        <ConfirmationModal
          visible={Boolean(deletingComment)}
          backdropClassName="screenshot-lightbox__confirmation-backdrop"
          title={t("screenshots_comment_delete_title")}
          description={t("screenshots_comment_delete_description")}
          confirmLabel={t("screenshots_comment_delete")}
          cancelLabel={t("screenshots_cancel")}
          danger
          loading={isDeleting}
          onClose={() => setDeletingComment(null)}
          onConfirm={confirmDelete}
        />

        <ScreenshotReportModal
          visible={Boolean(reportingComment)}
          title={t("screenshots_comment_report")}
          reasons={SCREENSHOT_COMMENT_REPORT_REASONS}
          isSubmitting={isReporting}
          onClose={() => setReportingComment(null)}
          onSubmit={submitReport}
        />
      </aside>
    </VerticalFocusGroup>
  );
}
