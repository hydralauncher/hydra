import {
  ArrowClockwiseIcon,
  ChatCircleIcon,
  ChatsCircleIcon,
  DotsThreeVerticalIcon,
  FlagIcon,
  PencilSimpleIcon,
  TrashIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  ProfileScreenshot,
  ScreenshotAuthor,
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
  getVotedScreenshotComment,
  pickCommentEditPatch,
  type ScreenshotPatch,
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
import {
  useBigPictureToast,
  useNavigation,
  useUserDetails,
} from "../../../../hooks";
import {
  NavigationService,
  type FocusOverrides,
  type FocusOverrideTarget,
} from "../../../../services";
import { getScreenshotErrorKey } from "../helpers";
import { ScreenshotReportModal } from "../screenshot-report-modal";
import { ScreenshotCommentBody } from "./comment-body";
import { CommentComposer } from "./comment-composer";
import {
  COMMENTS_NAVIGATION_ORDER,
  getCommentFocusIds,
  getScreenshotCommentsPanelFocusIds,
} from "./comment-focus-ids";
import {
  applyCommentWrites,
  type ScreenshotCommentWrite,
  type ScreenshotCommentWriteInput,
} from "./comment-writes";
import { useFailedCommentDrafts } from "./use-failed-comment-drafts";

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
  onScreenshotUpdate: (screenshotId: string, update: ScreenshotPatch) => void;
}

interface ConfirmedCommentEdit {
  bodyHtml: string;
  editedAt: number | null;
  version: number;
  inFlight: number;
}

const PENDING_COMMENT_ID_PREFIX = "pending:";
const VOTE_UNLOCK_DELAY_MS = 500;

const isPendingComment = (comment: ScreenshotComment) =>
  comment.id.startsWith(PENDING_COMMENT_ID_PREFIX);

const createPendingComment = (
  bodyHtml: string,
  author: ScreenshotAuthor
): ScreenshotComment => ({
  id: `${PENDING_COMMENT_ID_PREFIX}${crypto.randomUUID()}`,
  bodyHtml,
  createdAt: Date.now(),
  editedAt: null,
  author,
  upvotes: 0,
  downvotes: 0,
  myVote: null,
  isHidden: false,
  isOwn: true,
  canDelete: false,
});

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
  const [hasLoadMoreError, setHasLoadMoreError] = useState(false);
  const generationRef = useRef(0);
  const writeVersionRef = useRef(0);
  const writesRef = useRef<ScreenshotCommentWrite[]>([]);
  const pendingReadsRef = useRef(0);
  const readEpochRef = useRef(0);
  const ownerId = screenshot.owner.id;
  const screenshotId = screenshot.id;

  const beginRead = () => {
    pendingReadsRef.current += 1;
    return {
      sinceVersion: writeVersionRef.current,
      epoch: readEpochRef.current,
    };
  };

  const endRead = (epoch: number) => {
    if (readEpochRef.current !== epoch) return;
    pendingReadsRef.current = Math.max(0, pendingReadsRef.current - 1);
    if (pendingReadsRef.current === 0) writesRef.current = [];
  };

  const fetchFirstPage = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const { sinceVersion, epoch } = beginRead();

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
      endRead(epoch);
    }
  }, [needsAuth, ownerId, screenshotId]);

  useEffect(() => {
    generationRef.current += 1;
    readEpochRef.current += 1;
    pendingReadsRef.current = 0;
    writesRef.current = [];
    setComments([]);
    setTotal(0);
    setNextCursor(null);
    setIsLoadingMore(false);
    setHasLoadMoreError(false);

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
    const { sinceVersion, epoch } = beginRead();
    setIsLoadingMore(true);
    setHasLoadMoreError(false);

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
      if (generationRef.current === generation) setHasLoadMoreError(true);
    } finally {
      endRead(epoch);
      if (generationRef.current === generation) setIsLoadingMore(false);
    }
  }, [isLoadingMore, needsAuth, nextCursor, ownerId, screenshotId]);

  const retry = useCallback(() => {
    setStatus("loading");
    return fetchFirstPage();
  }, [fetchFirstPage]);

  return {
    comments,
    total,
    status,
    hasMore: Boolean(nextCursor),
    isLoadingMore,
    hasLoadMoreError,
    loadMore,
    retry,
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
  navigationOrder: number;
  onVote: (comment: ScreenshotComment, vote: ScreenshotCommentVoteType) => void;
  onOpenMenu: (comment: ScreenshotComment, element: HTMLElement) => void;
}

interface CommentVoteButtonProps {
  focusId: string;
  voteType: ScreenshotCommentVoteType;
  count: number;
  isActive: boolean;
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
  isDisabled,
  label,
  navigationOverrides,
  onVote,
}: Readonly<CommentVoteButtonProps>) {
  const Icon = voteType === "UPVOTE" ? ThumbsUpIcon : ThumbsDownIcon;

  return (
    <FocusItem id={focusId} navigationOverrides={navigationOverrides} asChild>
      <button
        type="button"
        className={cn("screenshot-comments__vote", {
          "screenshot-comments__vote--active": isActive,
        })}
        disabled={isDisabled}
        aria-label={label}
        aria-pressed={isActive}
        title={label}
        onClick={onVote}
      >
        <Icon size={20} weight={isActive ? "fill" : "regular"} />
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
  navigationOrder,
  onVote,
  onOpenMenu,
}: Readonly<CommentItemProps>) {
  const { t } = useTranslation("big_picture");
  const focusIds = getCommentFocusIds(comment.id);
  const moreButtonRef = useRef<HTMLDivElement | null>(null);

  return (
    <li className="screenshot-comments__item">
      <div className="screenshot-comments__item-top">
        <div className="screenshot-comments__item-header">
          <UserProfileAvatar
            image={comment.author.profileImageUrl}
            alt=""
            className="screenshot-comments__avatar"
            fallbackClassName="screenshot-comments__avatar--fallback"
            width={40}
            height={40}
            iconSize={20}
          />
          <div className="screenshot-comments__item-heading">
            <span className="screenshot-comments__author">
              {comment.author.displayName}
            </span>
            <span className="screenshot-comments__time">
              {formatRelativeDate(comment.createdAt, { locale: language })}
              {comment.editedAt ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="screenshot-comments__edited">
                    {t("screenshots_comment_edited")}
                  </span>
                </>
              ) : null}
            </span>
          </div>
        </div>

        <ScreenshotCommentBody bodyHtml={comment.bodyHtml} />
      </div>

      <HorizontalFocusGroup
        regionId={focusIds.region}
        navigationOrder={navigationOrder}
        asChild
      >
        <div className="screenshot-comments__item-actions">
          <div className="screenshot-comments__votes">
            <CommentVoteButton
              focusId={focusIds.upvote}
              voteType="UPVOTE"
              count={comment.upvotes}
              isActive={comment.myVote === "UPVOTE"}
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
        </div>
      </HorizontalFocusGroup>
    </li>
  );
}

interface CommentsListStatusProps {
  status: CommentsStatus;
  isEmpty: boolean;
  retryFocusId: string;
  leftTarget?: FocusOverrideTarget;
  onRetry: () => void;
}

function CommentsListStatus({
  status,
  isEmpty,
  retryFocusId,
  leftTarget,
  onRetry,
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
      <div className="screenshot-comments__status screenshot-comments__status--error">
        <p>{t("screenshots_comments_load_failed")}</p>
        <Button
          variant="secondary"
          size="small"
          focusId={retryFocusId}
          focusNavigationOrder={COMMENTS_NAVIGATION_ORDER.status}
          icon={<ArrowClockwiseIcon size={18} />}
          focusNavigationOverrides={
            leftTarget ? { left: leftTarget } : undefined
          }
          onClick={onRetry}
        >
          {t("screenshots_retry")}
        </Button>
      </div>
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

function getLoadMoreLabelKey(isLoadingMore: boolean, hasError: boolean) {
  if (isLoadingMore) return "screenshots_comments_loading";
  if (hasError) return "screenshots_retry";

  return "screenshots_comments_load_more";
}

export function ScreenshotCommentsPanel({
  screenshot,
  viewerId,
  isOwner,
  leftTarget,
  onCommentCountChange,
  onScreenshotUpdate,
}: Readonly<ScreenshotCommentsPanelProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const { setFocus } = useNavigation();
  const { userDetails } = useUserDetails();
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
    hasLoadMoreError,
    loadMore,
    retry: retryComments,
    recordWrite,
    setComments,
    setTotal,
  } = useScreenshotComments(screenshot, isAvailable, Boolean(viewerId));
  const commentsRef = useRef(comments);
  const [editingComment, setEditingComment] =
    useState<ScreenshotComment | null>(null);
  const draftKey = `${viewerId ?? ""}:${screenshot.id}`;
  const restoredDraft = useFailedCommentDrafts(
    (state) => state.draftsByKey[draftKey]?.[0] ?? null
  );
  const pushRestoredDraft = useFailedCommentDrafts((state) => state.push);
  const shiftRestoredDrafts = useFailedCommentDrafts((state) => state.shift);
  const editVersionsRef = useRef(new Map<string, number>());
  const confirmedEditsRef = useRef(new Map<string, ConfirmedCommentEdit>());
  const [votingIds, setVotingIds] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<CommentMenuState | null>(null);
  const [deletingComment, setDeletingComment] =
    useState<ScreenshotComment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [reportingComment, setReportingComment] =
    useState<ScreenshotComment | null>(null);
  const [isReporting, setIsReporting] = useState(false);
  const ownerId = screenshot.owner.id;

  useLayoutEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  useEffect(() => {
    setEditingComment(null);
    setMenu(null);
  }, [screenshot.id]);

  const shiftRestoredDraft = useCallback(
    () => shiftRestoredDrafts(draftKey),
    [draftKey, shiftRestoredDrafts]
  );

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

  const dropComment = useCallback(
    (commentId: string) => {
      const removed = commentsRef.current.find(
        (comment) => comment.id === commentId
      );
      if (!removed) return;

      commentsRef.current = commentsRef.current.filter(
        (comment) => comment.id !== commentId
      );
      recordWrite({
        kind: "remove",
        commentId: removed.id,
        wasCounted: !removed.isHidden,
      });
      setComments((current) =>
        current.filter((comment) => comment.id !== removed.id)
      );
      if (!removed.isHidden) {
        setTotal((current) => Math.max(0, current - 1));
        onCommentCountChange(screenshot.id, -1);
      }
      setEditingComment((current) =>
        current?.id === removed.id ? null : current
      );
    },
    [onCommentCountChange, recordWrite, screenshot.id, setComments, setTotal]
  );

  const removePendingComment = useCallback(
    (pendingId: string) => {
      const isListed = commentsRef.current.some(
        (comment) => comment.id === pendingId
      );
      recordWrite({ kind: "remove", commentId: pendingId, wasCounted: true });
      setComments((current) =>
        current.filter((comment) => comment.id !== pendingId)
      );
      if (isListed) setTotal((current) => Math.max(0, current - 1));
      onCommentCountChange(screenshot.id, -1);
    },
    [onCommentCountChange, recordWrite, screenshot.id, setComments, setTotal]
  );

  const publishComment = useCallback(
    async (pending: ScreenshotComment) => {
      try {
        const created =
          await globalThis.window.electron.hydraApi.post<ScreenshotComment>(
            buildUserScreenshotCommentsPath(ownerId, screenshot.id),
            { data: { bodyHtml: pending.bodyHtml }, needsAuth: true }
          );
        if (!created) {
          removePendingComment(pending.id);
          return;
        }

        recordWrite({
          kind: "remove",
          commentId: pending.id,
          wasCounted: true,
        });
        if (!created.isHidden) recordWrite({ kind: "add", comment: created });
        const isPendingShown = commentsRef.current.some(
          (comment) => comment.id === pending.id
        );
        const isCreatedShown = commentsRef.current.some(
          (comment) => comment.id === created.id
        );
        setComments((current) => {
          if (current.some((comment) => comment.id === pending.id)) {
            return current
              .filter((comment) => comment.id !== created.id)
              .map((comment) =>
                comment.id === pending.id ? created : comment
              );
          }
          if (current.some((comment) => comment.id === created.id)) {
            return current.map((comment) =>
              comment.id === created.id ? created : comment
            );
          }
          return [created, ...current];
        });
        if (isPendingShown) {
          if (created.isHidden) {
            setTotal((current) => Math.max(0, current - 1));
            onCommentCountChange(screenshot.id, -1);
          }
        } else if (created.isHidden) {
          onCommentCountChange(screenshot.id, -1);
        } else if (!isCreatedShown) {
          setTotal((current) => current + 1);
        }
      } catch (error) {
        removePendingComment(pending.id);
        pushRestoredDraft(draftKey, pending.bodyHtml);
        if (
          getScreenshotApiErrorCode(error) === "screenshots/comments-disabled"
        ) {
          onScreenshotUpdate(screenshot.id, {
            commentsEnabled: false,
            canComment: false,
          });
        }
        showError(error);
      }
    },
    [
      draftKey,
      onCommentCountChange,
      onScreenshotUpdate,
      ownerId,
      pushRestoredDraft,
      recordWrite,
      removePendingComment,
      screenshot.id,
      setComments,
      setTotal,
      showError,
    ]
  );

  const persistCommentEdit = useCallback(
    async (
      comment: ScreenshotComment,
      bodyHtml: string,
      editVersion: number,
      confirmed: ConfirmedCommentEdit
    ) => {
      const isLatestEdit = () =>
        editVersionsRef.current.get(comment.id) === editVersion;

      try {
        const updated =
          await globalThis.window.electron.hydraApi.patch<ScreenshotComment>(
            buildUserScreenshotCommentPath(ownerId, screenshot.id, comment.id),
            { data: { bodyHtml }, needsAuth: true }
          );
        if (editVersion > confirmed.version) {
          confirmed.bodyHtml = updated?.bodyHtml ?? bodyHtml;
          confirmed.editedAt = updated?.editedAt ?? Date.now();
          confirmed.version = editVersion;
        }
        if (!isLatestEdit()) return;
        if (updated) replaceComment(comment.id, pickCommentEditPatch(updated));
        if (updated && updated.isHidden !== comment.isHidden) {
          const delta = updated.isHidden ? -1 : 1;
          setTotal((current) => Math.max(0, current + delta));
          onCommentCountChange(screenshot.id, delta);
        }
      } catch (error) {
        if (
          getScreenshotApiErrorCode(error) === "screenshots/comment-not-found"
        ) {
          dropComment(comment.id);
        } else if (isLatestEdit()) {
          replaceComment(comment.id, {
            bodyHtml: confirmed.bodyHtml,
            editedAt: confirmed.editedAt,
          });
        }
        showError(error);
      } finally {
        confirmed.inFlight -= 1;
        if (confirmed.inFlight === 0) {
          confirmedEditsRef.current.delete(comment.id);
          const shown = commentsRef.current.find(
            (current) => current.id === comment.id
          );
          if (shown && shown.bodyHtml !== confirmed.bodyHtml) {
            replaceComment(comment.id, {
              bodyHtml: confirmed.bodyHtml,
              editedAt: confirmed.editedAt,
            });
          }
        }
      }
    },
    [
      dropComment,
      onCommentCountChange,
      ownerId,
      replaceComment,
      screenshot.id,
      setTotal,
      showError,
    ]
  );

  const submit = useCallback(
    async (html: string) => {
      const bodyHtml = normalizeScreenshotCommentBody(html);
      if (!bodyHtml) return false;

      if (editingComment) {
        const target =
          commentsRef.current.find(
            (comment) => comment.id === editingComment.id
          ) ?? editingComment;
        if (bodyHtml !== target.bodyHtml) {
          const editVersion = (editVersionsRef.current.get(target.id) ?? 0) + 1;
          editVersionsRef.current.set(target.id, editVersion);
          const confirmed = confirmedEditsRef.current.get(target.id) ?? {
            bodyHtml: target.bodyHtml,
            editedAt: target.editedAt,
            version: 0,
            inFlight: 0,
          };
          confirmed.inFlight += 1;
          confirmedEditsRef.current.set(target.id, confirmed);
          replaceComment(target.id, {
            bodyHtml,
            editedAt: Date.now(),
          });
          void persistCommentEdit(target, bodyHtml, editVersion, confirmed);
        }
        setEditingComment(null);
        return true;
      }

      if (!userDetails) return false;

      const pending = createPendingComment(bodyHtml, {
        id: userDetails.id,
        displayName: userDetails.displayName,
        profileImageUrl: userDetails.profileImageUrl,
      });
      recordWrite({ kind: "add", comment: pending });
      setComments((current) => [pending, ...current]);
      setTotal((current) => current + 1);
      onCommentCountChange(screenshot.id, 1);
      void publishComment(pending);
      return true;
    },
    [
      editingComment,
      onCommentCountChange,
      persistCommentEdit,
      publishComment,
      recordWrite,
      replaceComment,
      screenshot.id,
      setComments,
      setTotal,
      userDetails,
    ]
  );

  const vote = useCallback(
    async (comment: ScreenshotComment, voteType: ScreenshotCommentVoteType) => {
      if (!viewerId) {
        void globalThis.window.electron.openAuthWindow(AuthPage.SignIn);
        return;
      }
      if (votingIds.has(comment.id) || isPendingComment(comment)) return;

      const previous = {
        upvotes: comment.upvotes,
        downvotes: comment.downvotes,
        myVote: comment.myVote,
      };
      setVotingIds((current) => new Set(current).add(comment.id));
      replaceComment(comment.id, getVotedScreenshotComment(comment, voteType));

      try {
        await globalThis.window.electron.hydraApi.put<ScreenshotCommentVoteResponse>(
          buildUserScreenshotCommentVotePath(
            ownerId,
            screenshot.id,
            comment.id,
            voteType
          ),
          { needsAuth: true }
        );
      } catch (error) {
        if (
          getScreenshotApiErrorCode(error) === "screenshots/comment-not-found"
        ) {
          dropComment(comment.id);
        } else {
          replaceComment(comment.id, previous);
        }
        showError(error);
      } finally {
        setTimeout(() => {
          setVotingIds((current) => {
            const next = new Set(current);
            next.delete(comment.id);
            return next;
          });
        }, VOTE_UNLOCK_DELAY_MS);
      }
    },
    [
      dropComment,
      ownerId,
      replaceComment,
      screenshot.id,
      showError,
      viewerId,
      votingIds,
    ]
  );

  const confirmDelete = useCallback(async () => {
    if (!deletingComment) return;

    const closeAfterRemoval = () => {
      dropComment(deletingComment.id);
      NavigationService.getInstance().requestFocusWhenAvailable(
        viewerId ? focusIds.input : focusIds.signIn
      );
      setDeletingComment(null);
    };

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
      closeAfterRemoval();
      showSuccessToast(t("screenshots_comment_deleted"), {
        fallbackVisual: "settings",
      });
    } catch (error) {
      if (
        getScreenshotApiErrorCode(error) === "screenshots/comment-not-found"
      ) {
        closeAfterRemoval();
      }
      showError(error);
    } finally {
      setIsDeleting(false);
    }
  }, [
    deletingComment,
    dropComment,
    focusIds.input,
    focusIds.signIn,
    ownerId,
    screenshot.id,
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
        if (
          getScreenshotApiErrorCode(error) === "screenshots/already-reported"
        ) {
          showSuccessToast(t("screenshots_error_already_reported"), {
            fallbackVisual: "settings",
          });
          return true;
        }

        showError(error);
        return false;
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
    !isPendingComment(comment) &&
    ((comment.isOwn && screenshot.canComment) ||
      comment.canDelete ||
      (!comment.isOwn && Boolean(viewerId)));

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
          <CommentsListStatus
            status={status}
            isEmpty={comments.length === 0}
            retryFocusId={focusIds.retry}
            leftTarget={leftTarget}
            onRetry={() => void retryComments()}
          />

          {comments.length > 0 ? (
            <ul className="screenshot-comments__list">
              {comments.map((comment, index) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  navigationOrder={
                    COMMENTS_NAVIGATION_ORDER.firstComment + index
                  }
                  isSignedIn={Boolean(viewerId)}
                  hasMenu={hasMenu(comment)}
                  isVoting={
                    votingIds.has(comment.id) || isPendingComment(comment)
                  }
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

          {hasMore && hasLoadMoreError && !isLoadingMore ? (
            <p className="screenshot-comments__status screenshot-comments__status--error">
              {t("screenshots_comments_load_more_failed")}
            </p>
          ) : null}

          {hasMore ? (
            <FocusItem
              id={focusIds.loadMore}
              navigationOrder={COMMENTS_NAVIGATION_ORDER.loadMore}
              navigationOverrides={{ left: leftTarget }}
              asChild
            >
              <button
                type="button"
                className="screenshot-comments__load-more"
                disabled={isLoadingMore}
                onClick={() => void loadMore()}
              >
                {t(getLoadMoreLabelKey(isLoadingMore, hasLoadMoreError))}
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
          restoredDraft={restoredDraft}
          onRestoredDraftApplied={shiftRestoredDraft}
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
