import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  SCREENSHOT_COMMENTS_PAGE_SIZE,
  buildUserScreenshotCommentPath,
  buildUserScreenshotCommentReportPath,
  buildUserScreenshotCommentsPath,
  buildUserScreenshotCommentVotePath,
  getScreenshotApiErrorCode,
  getVotedScreenshotComment,
  mergeScreenshotPages,
  normalizeScreenshotCommentBody,
  normalizeScreenshotReportValues,
  pickCommentEditPatch,
} from "@shared";
import type {
  ProfileScreenshot,
  ScreenshotAuthor,
  ScreenshotComment,
  ScreenshotCommentReportReason,
  ScreenshotCommentsResponse,
  ScreenshotCommentVoteResponse,
  ScreenshotCommentVoteType,
  ScreenshotReportValues,
} from "@types";

import type { ScreenshotFailure } from "./use-screenshot-actions";
import {
  queueRestoredCommentDraft,
  useRestoredCommentDraft,
} from "./restored-comment-drafts";
import type { ScreenshotCommentSort, ScreenshotPatch } from "@shared";

type CommentWrite =
  | { kind: "create"; comment: ScreenshotComment }
  | { kind: "replace"; commentId: string; comment: ScreenshotComment }
  | { kind: "patch"; commentId: string; patch: Partial<ScreenshotComment> }
  | { kind: "delete"; commentId: string };

interface VersionedCommentWrite {
  version: number;
  write: CommentWrite;
}

interface ConfirmedCommentEdit {
  patch: Partial<ScreenshotComment>;
  version: number;
  shownIsHidden: boolean;
  pendingVersions: Set<number>;
}

const VOTE_UNLOCK_DELAY_MS = 500;

const adjustCommentCount =
  (delta: number) =>
  (screenshot: ProfileScreenshot): Partial<ProfileScreenshot> => ({
    commentCount: Math.max(0, screenshot.commentCount + delta),
  });

const applyCommentWrite = (
  comments: ScreenshotComment[],
  write: CommentWrite,
  includeCreated: boolean
) => {
  if (write.kind === "create") {
    const exists = comments.some((item) => item.id === write.comment.id);
    return exists || !includeCreated ? comments : [write.comment, ...comments];
  }

  if (write.kind === "replace") {
    const hasPlaceholder = comments.some((item) => item.id === write.commentId);
    if (!hasPlaceholder) {
      return applyCommentWrite(
        comments,
        { kind: "create", comment: write.comment },
        includeCreated
      );
    }
    return comments
      .filter((item) => item.id !== write.comment.id)
      .map((item) => (item.id === write.commentId ? write.comment : item));
  }

  if (write.kind === "delete") {
    return comments.filter((item) => item.id !== write.commentId);
  }

  return comments.map((item) =>
    item.id === write.commentId ? { ...item, ...write.patch } : item
  );
};

const replayCommentWrites = (
  comments: ScreenshotComment[],
  writes: VersionedCommentWrite[],
  sinceVersion: number,
  includeCreated: boolean
) => {
  const laterWrites = writes.filter(({ version }) => version > sinceVersion);
  const result = laterWrites.reduce(
    (current, { write }) => applyCommentWrite(current, write, includeCreated),
    comments
  );

  return {
    comments: result,
    delta: result.length - comments.length,
    hasLaterWrites: laterWrites.length > 0,
  };
};

const createPendingComment = (
  bodyHtml: string,
  author: ScreenshotAuthor
): ScreenshotComment => ({
  id: `pending:${crypto.randomUUID()}`,
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

interface UseScreenshotCommentsOptions {
  screenshot: ProfileScreenshot;
  author: ScreenshotAuthor | null;
  isEnabled: boolean;
  isSignedIn: boolean;
  sort: ScreenshotCommentSort;
  onPatch: (screenshotId: string, patch: ScreenshotPatch) => void;
  onFailure: (screenshotId: string, failure: ScreenshotFailure) => void;
}

export function useScreenshotComments({
  screenshot,
  author,
  isEnabled,
  isSignedIn,
  sort,
  onPatch,
  onFailure,
}: UseScreenshotCommentsOptions) {
  const { t } = useTranslation("screenshots");
  const { showErrorToast, showSuccessToast } = useToast();
  const ownerId = screenshot.owner.id;
  const screenshotId = screenshot.id;
  const draftKey = `${author?.id ?? ""}:${screenshotId}`;
  const [comments, setComments] = useState<ScreenshotComment[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(isEnabled);
  const [hasFailed, setHasFailed] = useState(false);
  const { restoredDraft, clearRestoredDraft } =
    useRestoredCommentDraft(draftKey);
  const [pendingCommentIds, setPendingCommentIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [reportedCommentIds, setReportedCommentIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [newCommentId, setNewCommentId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const isReadInFlightRef = useRef(false);
  const writeVersionRef = useRef(0);
  const writesRef = useRef<VersionedCommentWrite[]>([]);
  const editVersionsRef = useRef(new Map<string, number>());
  const confirmedEditsRef = useRef(new Map<string, ConfirmedCommentEdit>());
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const screenshotIdRef = useRef(screenshotId);
  screenshotIdRef.current = screenshotId;

  const setPending = useCallback((commentId: string, isPending: boolean) => {
    setPendingCommentIds((current) => {
      const next = new Set(current);
      if (isPending) next.add(commentId);
      else next.delete(commentId);
      return next;
    });
  }, []);

  const fetchPage = useCallback(
    (cursor: string | null) =>
      window.electron.hydraApi.get<ScreenshotCommentsResponse>(
        buildUserScreenshotCommentsPath(ownerId, screenshotId, {
          cursor,
          take: SCREENSHOT_COMMENTS_PAGE_SIZE,
          sort,
        }),
        { needsAuth: isSignedIn }
      ),
    [isSignedIn, ownerId, screenshotId, sort]
  );

  const handleAccessError = useCallback(
    (error: unknown) => {
      const code = getScreenshotApiErrorCode(error);
      if (code === "screenshots/not-found") {
        onFailure(screenshotId, "unavailable");
        return true;
      }
      if (code === "screenshots/private") {
        onFailure(screenshotId, "private");
        return true;
      }
      return false;
    },
    [onFailure, screenshotId]
  );

  const startRead = useCallback(() => {
    isReadInFlightRef.current = true;
    return writeVersionRef.current;
  }, []);

  const finishRead = useCallback(
    (
      items: ScreenshotComment[],
      sinceVersion: number,
      includeCreated: boolean
    ) => {
      const replayed = replayCommentWrites(
        items,
        writesRef.current,
        sinceVersion,
        includeCreated
      );
      writesRef.current = [];
      isReadInFlightRef.current = false;
      return replayed;
    },
    []
  );

  const recordWrite = useCallback((write: CommentWrite) => {
    writeVersionRef.current += 1;
    if (isReadInFlightRef.current) {
      writesRef.current.push({ version: writeVersionRef.current, write });
    }
    setComments((current) => applyCommentWrite(current, write, true));
  }, []);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const sinceVersion = startRead();
    setIsLoading(true);
    setHasFailed(false);

    try {
      const response = await fetchPage(null);
      if (requestId !== requestIdRef.current) return;

      const replayed = finishRead(response?.items ?? [], sinceVersion, true);
      setComments(replayed.comments);
      setTotal(Math.max(0, (response?.total ?? 0) + replayed.delta));
      setNextCursor(response?.nextCursor ?? null);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      logger.error("Failed to load screenshot comments", error);
      if (!handleAccessError(error)) setHasFailed(true);
    } finally {
      if (requestId === requestIdRef.current) {
        isReadInFlightRef.current = false;
        setIsLoading(false);
      }
    }
  }, [fetchPage, finishRead, handleAccessError, startRead]);

  const loadMore = useCallback(async () => {
    if (isLoading || !nextCursor) return;

    const requestId = requestIdRef.current;
    const sinceVersion = startRead();
    setIsLoading(true);

    try {
      const response = await fetchPage(nextCursor);
      if (requestId !== requestIdRef.current || !response) return;

      const replayed = finishRead(response.items, sinceVersion, false);
      setComments((current) =>
        mergeScreenshotPages(current, replayed.comments)
      );
      setTotal((current) =>
        replayed.hasLaterWrites ? current : response.total
      );
      setNextCursor(response.nextCursor);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      logger.error("Failed to load more screenshot comments", error);
      showErrorToast(t("comments_load_failed"));
    } finally {
      if (requestId === requestIdRef.current) {
        isReadInFlightRef.current = false;
        setIsLoading(false);
      }
    }
  }, [
    fetchPage,
    finishRead,
    isLoading,
    nextCursor,
    showErrorToast,
    startRead,
    t,
  ]);

  useEffect(() => {
    requestIdRef.current += 1;
    isReadInFlightRef.current = false;
    writesRef.current = [];
    setComments([]);
    setNextCursor(null);
    setHasFailed(false);
    setIsLoading(false);
    setNewCommentId(null);

    if (isEnabled) void reload();
  }, [isEnabled, reload]);

  const removeMissingComment = useCallback(
    (commentId: string) => {
      const removed = commentsRef.current.find(
        (comment) => comment.id === commentId
      );
      if (!removed) return;

      recordWrite({ kind: "delete", commentId });
      setTotal((current) => Math.max(0, (current ?? 1) - 1));
      if (!removed.isHidden) {
        onPatch(screenshotId, adjustCommentCount(-1));
      }
    },
    [onPatch, recordWrite, screenshotId]
  );

  const handleWriteError = useCallback(
    (error: unknown, fallbackKey: string, commentId?: string) => {
      const code = getScreenshotApiErrorCode(error);

      if (code === "screenshots/comments-disabled") {
        onPatch(screenshotId, { commentsEnabled: false, canComment: false });
        showErrorToast(t("comments_turned_off"));
        return;
      }

      if (code === "screenshots/comment-not-allowed") {
        showErrorToast(t("comment_not_allowed"));
        return;
      }

      if (code === "screenshots/comment-rate-limited") {
        showErrorToast(t("comment_rate_limited"));
        return;
      }

      if (code === "screenshots/moderation-in-progress") {
        showErrorToast(t("moderation_in_progress"));
        return;
      }

      if (code === "screenshots/comment-rate-limit-unavailable") {
        showErrorToast(t("comments_temporarily_unavailable"));
        return;
      }

      if (code === "screenshots/comment-not-found") {
        if (commentId) removeMissingComment(commentId);
        showErrorToast(t("comment_unavailable"));
        return;
      }

      if (handleAccessError(error)) return;
      showErrorToast(t(fallbackKey));
    },
    [
      handleAccessError,
      onPatch,
      removeMissingComment,
      screenshotId,
      showErrorToast,
      t,
    ]
  );

  const publishComment = useCallback(
    async (pendingId: string, bodyHtml: string) => {
      try {
        const comment = await window.electron.hydraApi.post<ScreenshotComment>(
          buildUserScreenshotCommentsPath(ownerId, screenshotId),
          { data: { bodyHtml }, needsAuth: true }
        );

        if (screenshotIdRef.current === screenshotId) {
          const isListed = commentsRef.current.some(
            ({ id }) => id === pendingId || id === comment.id
          );
          recordWrite({ kind: "replace", commentId: pendingId, comment });
          setNewCommentId((current) =>
            current === pendingId ? comment.id : current
          );
          if (!isListed && !isReadInFlightRef.current) {
            setTotal((current) => (current ?? 0) + 1);
          }
        }
        if (comment.isHidden) {
          onPatch(screenshotId, adjustCommentCount(-1));
        }
        showSuccessToast(t("comment_posted"));
      } catch (error) {
        logger.error("Failed to post screenshot comment", error);
        const isListed =
          screenshotIdRef.current === screenshotId &&
          commentsRef.current.some(({ id }) => id === pendingId);
        recordWrite({ kind: "delete", commentId: pendingId });
        setNewCommentId((current) => (current === pendingId ? null : current));
        if (isListed) setTotal((current) => Math.max(0, (current ?? 1) - 1));
        onPatch(screenshotId, adjustCommentCount(-1));
        queueRestoredCommentDraft(draftKey, bodyHtml);
        handleWriteError(error, "comment_post_failed");
      } finally {
        setPending(pendingId, false);
      }
    },
    [
      draftKey,
      handleWriteError,
      onPatch,
      ownerId,
      recordWrite,
      screenshotId,
      setPending,
      showSuccessToast,
      t,
    ]
  );

  const clearNewComment = useCallback(() => setNewCommentId(null), []);

  const createComment = useCallback(
    (body: string) => {
      const normalizedBody = normalizeScreenshotCommentBody(body);
      if (!normalizedBody || !author) return Promise.resolve(false);

      const pendingComment = createPendingComment(normalizedBody, author);
      setPending(pendingComment.id, true);
      recordWrite({ kind: "create", comment: pendingComment });
      setNewCommentId(pendingComment.id);
      setTotal((current) => (current ?? 0) + 1);
      onPatch(screenshotId, adjustCommentCount(1));
      void publishComment(pendingComment.id, normalizedBody);
      return Promise.resolve(true);
    },
    [author, onPatch, publishComment, recordWrite, screenshotId, setPending]
  );

  const showConfirmedEdit = useCallback(
    (commentId: string, confirmed: ConfirmedCommentEdit) => {
      recordWrite({ kind: "patch", commentId, patch: confirmed.patch });
      const isHidden = confirmed.patch.isHidden ?? confirmed.shownIsHidden;
      if (isHidden === confirmed.shownIsHidden) return;
      confirmed.shownIsHidden = isHidden;
      onPatch(screenshotId, adjustCommentCount(isHidden ? -1 : 1));
    },
    [onPatch, recordWrite, screenshotId]
  );

  const persistCommentEdit = useCallback(
    async (
      comment: ScreenshotComment,
      bodyHtml: string,
      editVersion: number,
      confirmed: ConfirmedCommentEdit
    ) => {
      try {
        const updated = await window.electron.hydraApi.patch<ScreenshotComment>(
          buildUserScreenshotCommentPath(ownerId, screenshotId, comment.id),
          { data: { bodyHtml }, needsAuth: true }
        );

        if (editVersion > confirmed.version) {
          confirmed.patch = updated
            ? pickCommentEditPatch(updated)
            : { bodyHtml, editedAt: Date.now() };
          confirmed.version = editVersion;
        }
        const hasNewerEdit = [...confirmed.pendingVersions].some(
          (version) => version > editVersion
        );
        if (!hasNewerEdit) showSuccessToast(t("comment_updated"));
      } catch (error) {
        logger.error("Failed to edit screenshot comment", error);
        handleWriteError(error, "comment_edit_failed", comment.id);
      } finally {
        confirmed.pendingVersions.delete(editVersion);
        const hasNewerPendingEdit = [...confirmed.pendingVersions].some(
          (version) => version > editVersion
        );
        if (!hasNewerPendingEdit) showConfirmedEdit(comment.id, confirmed);
        if (confirmed.pendingVersions.size === 0) {
          confirmedEditsRef.current.delete(comment.id);
        }
      }
    },
    [
      handleWriteError,
      ownerId,
      screenshotId,
      showConfirmedEdit,
      showSuccessToast,
      t,
    ]
  );

  const editComment = useCallback(
    (comment: ScreenshotComment, body: string) => {
      const normalizedBody = normalizeScreenshotCommentBody(body);
      if (!normalizedBody) return Promise.resolve(false);
      if (normalizedBody === comment.bodyHtml) return Promise.resolve(true);
      if (pendingCommentIds.has(comment.id)) return Promise.resolve(false);

      const editVersion = (editVersionsRef.current.get(comment.id) ?? 0) + 1;
      editVersionsRef.current.set(comment.id, editVersion);
      const confirmed = confirmedEditsRef.current.get(comment.id) ?? {
        patch: { bodyHtml: comment.bodyHtml, editedAt: comment.editedAt },
        version: 0,
        shownIsHidden: comment.isHidden,
        pendingVersions: new Set<number>(),
      };
      confirmed.pendingVersions.add(editVersion);
      confirmedEditsRef.current.set(comment.id, confirmed);
      recordWrite({
        kind: "patch",
        commentId: comment.id,
        patch: { bodyHtml: normalizedBody, editedAt: Date.now() },
      });
      void persistCommentEdit(comment, normalizedBody, editVersion, confirmed);
      return Promise.resolve(true);
    },
    [pendingCommentIds, persistCommentEdit, recordWrite]
  );

  const deleteComment = useCallback(
    async (comment: ScreenshotComment) => {
      if (pendingCommentIds.has(comment.id)) return false;

      setPending(comment.id, true);
      try {
        await window.electron.hydraApi.delete(
          buildUserScreenshotCommentPath(ownerId, screenshotId, comment.id),
          { needsAuth: true }
        );

        recordWrite({ kind: "delete", commentId: comment.id });
        setTotal((current) => Math.max(0, (current ?? 1) - 1));
        if (!comment.isHidden) {
          onPatch(screenshotId, adjustCommentCount(-1));
        }
        showSuccessToast(t("comment_deleted"));
        return true;
      } catch (error) {
        logger.error("Failed to delete screenshot comment", error);
        handleWriteError(error, "comment_delete_failed", comment.id);
        return (
          getScreenshotApiErrorCode(error) === "screenshots/comment-not-found"
        );
      } finally {
        setPending(comment.id, false);
      }
    },
    [
      handleWriteError,
      onPatch,
      recordWrite,
      ownerId,
      pendingCommentIds,
      screenshotId,
      setPending,
      showSuccessToast,
      t,
    ]
  );

  const voteComment = useCallback(
    async (comment: ScreenshotComment, vote: ScreenshotCommentVoteType) => {
      if (pendingCommentIds.has(comment.id)) return;

      const previous = {
        upvotes: comment.upvotes,
        downvotes: comment.downvotes,
        myVote: comment.myVote,
      };
      const applyVote = (
        patch: Pick<ScreenshotComment, "upvotes" | "downvotes" | "myVote">
      ) => recordWrite({ kind: "patch", commentId: comment.id, patch });

      setPending(comment.id, true);
      applyVote(getVotedScreenshotComment(comment, vote));

      try {
        await window.electron.hydraApi.put<ScreenshotCommentVoteResponse>(
          buildUserScreenshotCommentVotePath(
            ownerId,
            screenshotId,
            comment.id,
            vote
          ),
          { needsAuth: true }
        );
      } catch (error) {
        applyVote(previous);
        logger.error("Failed to vote on screenshot comment", error);
        handleWriteError(error, "comment_vote_failed", comment.id);
      } finally {
        setTimeout(() => setPending(comment.id, false), VOTE_UNLOCK_DELAY_MS);
      }
    },
    [
      handleWriteError,
      ownerId,
      pendingCommentIds,
      recordWrite,
      screenshotId,
      setPending,
    ]
  );

  const reportComment = useCallback(
    async (
      comment: ScreenshotComment,
      values: ScreenshotReportValues<ScreenshotCommentReportReason>
    ) => {
      if (pendingCommentIds.has(comment.id)) return false;

      setPending(comment.id, true);
      try {
        await window.electron.hydraApi.post(
          buildUserScreenshotCommentReportPath(
            ownerId,
            screenshotId,
            comment.id
          ),
          { data: normalizeScreenshotReportValues(values), needsAuth: true }
        );
        setReportedCommentIds((current) => new Set(current).add(comment.id));
        showSuccessToast(t("comment_reported"));
        return true;
      } catch (error) {
        logger.error("Failed to report screenshot comment", error);
        const code = getScreenshotApiErrorCode(error);

        if (code === "screenshots/already-reported") {
          setReportedCommentIds((current) => new Set(current).add(comment.id));
          showSuccessToast(t("comment_already_reported"));
          return true;
        }

        if (code === "screenshots/report-rate-limited") {
          showErrorToast(t("report_rate_limited"));
          return false;
        }

        handleWriteError(error, "report_failed", comment.id);
        return code === "screenshots/comment-not-found";
      } finally {
        setPending(comment.id, false);
      }
    },
    [
      handleWriteError,
      ownerId,
      pendingCommentIds,
      screenshotId,
      setPending,
      showErrorToast,
      showSuccessToast,
      t,
    ]
  );

  return {
    comments,
    total,
    hasMore: nextCursor !== null,
    isLoading,
    hasFailed,
    restoredDraft,
    clearRestoredDraft,
    pendingCommentIds,
    reportedCommentIds,
    newCommentId,
    clearNewComment,
    reload,
    loadMore,
    createComment,
    editComment,
    deleteComment,
    voteComment,
    reportComment,
  };
}
