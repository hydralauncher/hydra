import {
  ArrowFatDownIcon,
  ArrowFatUpIcon,
  DotsThreeVerticalIcon,
  FlagIcon,
  PaperPlaneRightIcon,
  PencilSimpleIcon,
  SignInIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
  SCREENSHOT_COMMENT_MAX_LENGTH,
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
  Input,
  UserProfileAvatar,
  VerticalFocusGroup,
  type ContextMenuItem,
} from "../../../common";
import { ConfirmationModal } from "../../../modals";
import { formatRelativeDate } from "../../../../helpers";
import { useBigPictureToast, useNavigation } from "../../../../hooks";
import type { FocusOverrideTarget } from "../../../../services";
import { getScreenshotErrorKey } from "../helpers";
import { ScreenshotReportModal } from "../screenshot-report-modal";
import {
  applyCommentWrites,
  type ScreenshotCommentWrite,
  type ScreenshotCommentWriteInput,
} from "./comment-writes";

export interface ScreenshotCommentsPanelFocusIds {
  region: string;
  composerRegion: string;
  input: string;
  send: string;
  cancelEdit: string;
  signIn: string;
  loadMore: string;
}

export const getScreenshotCommentsPanelFocusIds = (
  screenshotId: string
): ScreenshotCommentsPanelFocusIds => ({
  region: `screenshot-comments:${screenshotId}`,
  composerRegion: `screenshot-comments-composer:${screenshotId}`,
  input: `screenshot-comments-input:${screenshotId}`,
  send: `screenshot-comments-send:${screenshotId}`,
  cancelEdit: `screenshot-comments-cancel-edit:${screenshotId}`,
  signIn: `screenshot-comments-sign-in:${screenshotId}`,
  loadMore: `screenshot-comments-load-more:${screenshotId}`,
});

const getCommentFocusIds = (commentId: string) => ({
  region: `screenshot-comment:${commentId}`,
  upvote: `screenshot-comment-upvote:${commentId}`,
  downvote: `screenshot-comment-downvote:${commentId}`,
  more: `screenshot-comment-more:${commentId}`,
});

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
  onCommentCountChange: (screenshotId: string, commentCount: number) => void;
  onOverlayChange: (isOpen: boolean) => void;
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
      setTotal(Math.max(0, (response?.total ?? 0) + merged.totalDelta));
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
  canVote: boolean;
  hasMenu: boolean;
  isVoting: boolean;
  language: string;
  leftTarget: FocusOverrideTarget;
  onVote: (comment: ScreenshotComment, vote: ScreenshotCommentVoteType) => void;
  onOpenMenu: (comment: ScreenshotComment, element: HTMLElement) => void;
}

function CommentItem({
  comment,
  canVote,
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

      <p
        className={cn("screenshot-comments__body", {
          "screenshot-comments__body--hidden": comment.isHidden,
        })}
      >
        {comment.body}
      </p>

      <HorizontalFocusGroup
        regionId={focusIds.region}
        className="screenshot-comments__item-actions"
      >
        <Button
          variant="secondary"
          size="small"
          focusId={focusIds.upvote}
          disabled={!canVote || isVoting}
          focusNavigationOverrides={{ left: leftTarget }}
          className={cn("screenshot-comments__vote", {
            "screenshot-comments__vote--active": comment.myVote === "UPVOTE",
          })}
          icon={
            <ArrowFatUpIcon
              size={16}
              weight={comment.myVote === "UPVOTE" ? "fill" : "regular"}
            />
          }
          aria-label={t("screenshots_comment_upvote")}
          title={t("screenshots_comment_upvote")}
          onClick={() => onVote(comment, "UPVOTE")}
        >
          {String(comment.upvotes)}
        </Button>
        <Button
          variant="secondary"
          size="small"
          focusId={focusIds.downvote}
          disabled={!canVote || isVoting}
          className={cn("screenshot-comments__vote", {
            "screenshot-comments__vote--active": comment.myVote === "DOWNVOTE",
          })}
          icon={
            <ArrowFatDownIcon
              size={16}
              weight={comment.myVote === "DOWNVOTE" ? "fill" : "regular"}
            />
          }
          aria-label={t("screenshots_comment_downvote")}
          title={t("screenshots_comment_downvote")}
          onClick={() => onVote(comment, "DOWNVOTE")}
        >
          {String(comment.downvotes)}
        </Button>
        {hasMenu ? (
          <div ref={moreButtonRef} className="screenshot-comments__more">
            <Button
              variant="secondary"
              size="icon"
              focusId={focusIds.more}
              icon={<DotsThreeVerticalIcon size={18} weight="bold" />}
              aria-label={t("screenshots_comment_options")}
              title={t("screenshots_comment_options")}
              focusNavigationOverrides={{ right: { type: "block" } }}
              onClick={() => {
                if (moreButtonRef.current)
                  onOpenMenu(comment, moreButtonRef.current);
              }}
            >
              {null}
            </Button>
          </div>
        ) : null}
      </HorizontalFocusGroup>
    </li>
  );
}

interface CommentComposerProps {
  screenshot: ProfileScreenshot;
  viewerId: string | null;
  isOwner: boolean;
  focusIds: ScreenshotCommentsPanelFocusIds;
  leftTarget: FocusOverrideTarget;
  value: string;
  isEditing: boolean;
  isSubmitting: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancelEdit: () => void;
}

function getComposerNoticeKey(screenshot: ProfileScreenshot, isOwner: boolean) {
  const isAwaitingApproval =
    screenshot.moderationStatus !== undefined &&
    screenshot.moderationStatus !== "APPROVED";

  if (isOwner && isAwaitingApproval) return null;
  if (!screenshot.commentsEnabled) return "screenshots_comments_disabled";

  return "screenshots_comments_not_allowed";
}

function CommentComposer({
  screenshot,
  viewerId,
  isOwner,
  focusIds,
  leftTarget,
  value,
  isEditing,
  isSubmitting,
  onChange,
  onSubmit,
  onCancelEdit,
}: Readonly<CommentComposerProps>) {
  const { t } = useTranslation("big_picture");

  if (!viewerId) {
    return (
      <div className="screenshot-comments__notice">
        <p>{t("screenshots_comments_sign_in")}</p>
        <Button
          variant="secondary"
          size="small"
          focusId={focusIds.signIn}
          icon={<SignInIcon size={18} />}
          focusNavigationOverrides={{ left: leftTarget }}
          onClick={() =>
            void globalThis.window.electron.openAuthWindow(AuthPage.SignIn)
          }
        >
          {t("screenshots_sign_in")}
        </Button>
      </div>
    );
  }

  if (!screenshot.canComment && !isEditing) {
    const noticeKey = getComposerNoticeKey(screenshot, isOwner);
    if (!noticeKey) return null;

    return (
      <div className="screenshot-comments__notice">
        <p>{t(noticeKey)}</p>
      </div>
    );
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="screenshot-comments__composer" onSubmit={handleSubmit}>
      {isEditing ? (
        <span className="screenshot-comments__editing-label">
          {t("screenshots_comment_editing")}
        </span>
      ) : null}
      <HorizontalFocusGroup
        regionId={focusIds.composerRegion}
        className="screenshot-comments__composer-row"
      >
        <Input
          className="screenshot-comments__input"
          placeholder={t("screenshots_comment_placeholder")}
          value={value}
          maxLength={SCREENSHOT_COMMENT_MAX_LENGTH}
          disabled={isSubmitting}
          focusId={focusIds.input}
          focusNavigationOverrides={{ left: leftTarget }}
          aria-label={t("screenshots_comment_placeholder")}
          onChange={(event) => onChange(event.target.value)}
        />
        {isEditing ? (
          <Button
            variant="secondary"
            size="icon"
            focusId={focusIds.cancelEdit}
            disabled={isSubmitting}
            icon={<XIcon size={18} />}
            aria-label={t("screenshots_cancel")}
            title={t("screenshots_cancel")}
            onClick={onCancelEdit}
          >
            {null}
          </Button>
        ) : null}
        <Button
          size="icon"
          focusId={focusIds.send}
          loading={isSubmitting}
          disabled={value.trim().length === 0}
          icon={<PaperPlaneRightIcon size={18} />}
          aria-label={t(
            isEditing ? "screenshots_save" : "screenshots_comment_send"
          )}
          title={t(isEditing ? "screenshots_save" : "screenshots_comment_send")}
          focusNavigationOverrides={{ right: { type: "block" } }}
          onClick={onSubmit}
        >
          {null}
        </Button>
      </HorizontalFocusGroup>
      <span className="screenshot-comments__counter">
        {value.length}/{SCREENSHOT_COMMENT_MAX_LENGTH}
      </span>
    </form>
  );
}

export function ScreenshotCommentsPanel({
  screenshot,
  viewerId,
  isOwner,
  leftTarget,
  onCommentCountChange,
  onOverlayChange,
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
  const [draft, setDraft] = useState("");
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

  const isOverlayOpen = Boolean(menu || deletingComment || reportingComment);

  useEffect(() => {
    setDraft("");
    setEditingComment(null);
    setMenu(null);
  }, [screenshot.id]);

  useEffect(() => {
    onOverlayChange(isOverlayOpen);
  }, [isOverlayOpen, onOverlayChange]);

  useEffect(() => () => onOverlayChange(false), [onOverlayChange]);

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

  const submit = useCallback(async () => {
    const body = normalizeScreenshotCommentBody(draft);
    if (!body || isSubmitting) return;

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
            { data: { body }, needsAuth: true }
          );
        replaceComment(editingComment.id, updated ?? { body });
        setEditingComment(null);
      } else {
        const created =
          await globalThis.window.electron.hydraApi.post<ScreenshotComment>(
            buildUserScreenshotCommentsPath(ownerId, screenshot.id),
            { data: { body }, needsAuth: true }
          );
        if (created) {
          recordWrite({ kind: "add", comment: created });
          setComments((current) => [created, ...current]);
          setTotal((current) => current + 1);
          onCommentCountChange(screenshot.id, screenshot.commentCount + 1);
        }
      }
      setDraft("");
    } catch (error) {
      showError(error);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    draft,
    editingComment,
    recordWrite,
    isSubmitting,
    onCommentCountChange,
    screenshot.commentCount,
    ownerId,
    replaceComment,
    screenshot.id,
    setComments,
    setTotal,
    showError,
  ]);

  const vote = useCallback(
    async (comment: ScreenshotComment, voteType: ScreenshotCommentVoteType) => {
      if (!viewerId || comment.isOwn || votingIds.has(comment.id)) return;

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
      recordWrite({ kind: "remove", commentId: deletingComment.id });
      setComments((current) =>
        current.filter((comment) => comment.id !== deletingComment.id)
      );
      setTotal((current) => Math.max(0, current - 1));
      if (!deletingComment.isHidden)
        onCommentCountChange(
          screenshot.id,
          Math.max(0, screenshot.commentCount - 1)
        );
      if (editingComment?.id === deletingComment.id) {
        setEditingComment(null);
        setDraft("");
      }
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
    screenshot.commentCount,
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
        onSelect: () => {
          setEditingComment(comment);
          setDraft(comment.body);
          globalThis.window.requestAnimationFrame(() => {
            setFocus(focusIds.input);
          });
        },
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
  }, [focusIds.input, menu, screenshot.canComment, setFocus, t, viewerId]);

  const hasMenu = (comment: ScreenshotComment) =>
    (comment.isOwn && screenshot.canComment) ||
    comment.canDelete ||
    (!comment.isOwn && Boolean(viewerId));

  return (
    <VerticalFocusGroup regionId={focusIds.region} asChild>
      <aside className="screenshot-comments">
        <header className="screenshot-comments__header">
          <h2>{t("screenshots_comments_title")}</h2>
          {total > 0 ? (
            <span className="screenshot-comments__count">{total}</span>
          ) : null}
        </header>

        <CommentComposer
          screenshot={screenshot}
          viewerId={viewerId}
          isOwner={isOwner}
          focusIds={focusIds}
          leftTarget={leftTarget}
          value={draft}
          isEditing={Boolean(editingComment)}
          isSubmitting={isSubmitting}
          onChange={setDraft}
          onSubmit={() => void submit()}
          onCancelEdit={() => {
            setEditingComment(null);
            setDraft("");
          }}
        />

        <div className="screenshot-comments__scroll">
          {status === "loading" ? (
            <p className="screenshot-comments__empty">
              {t("screenshots_comments_loading")}
            </p>
          ) : null}
          {status === "error" ? (
            <p className="screenshot-comments__empty">
              {t("screenshots_comments_load_failed")}
            </p>
          ) : null}
          {status === "ready" && comments.length === 0 ? (
            <p className="screenshot-comments__empty">
              {t("screenshots_comments_empty")}
            </p>
          ) : null}

          {comments.length > 0 ? (
            <ul className="screenshot-comments__list">
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  canVote={Boolean(viewerId) && !comment.isOwn}
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
