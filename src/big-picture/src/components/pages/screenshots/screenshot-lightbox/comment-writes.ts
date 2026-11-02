import type { ScreenshotComment } from "@types";

export type ScreenshotCommentWriteInput =
  | { kind: "add"; comment: ScreenshotComment }
  | { kind: "patch"; commentId: string; patch: Partial<ScreenshotComment> }
  | { kind: "remove"; commentId: string; wasCounted: boolean };

export type ScreenshotCommentWrite = ScreenshotCommentWriteInput & {
  version: number;
};

interface CommentWriteResult {
  comments: ScreenshotComment[];
  countDelta: number;
}

const unchanged = (comments: ScreenshotComment[]): CommentWriteResult => ({
  comments,
  countDelta: 0,
});

const applyAdd = (
  comments: ScreenshotComment[],
  comment: ScreenshotComment,
  includeAdds: boolean
): CommentWriteResult => {
  const isPresent = comments.some((item) => item.id === comment.id);
  if (!includeAdds || isPresent) return unchanged(comments);

  return { comments: [comment, ...comments], countDelta: 1 };
};

const applyRemove = (
  comments: ScreenshotComment[],
  commentId: string,
  wasCounted: boolean
): CommentWriteResult => {
  const next = comments.filter((item) => item.id !== commentId);
  const removedCount = comments.length - next.length;

  return { comments: next, countDelta: wasCounted ? -removedCount : 0 };
};

const applyWrite = (
  comments: ScreenshotComment[],
  write: ScreenshotCommentWriteInput,
  includeAdds: boolean
): CommentWriteResult => {
  if (write.kind === "add")
    return applyAdd(comments, write.comment, includeAdds);
  if (write.kind === "remove")
    return applyRemove(comments, write.commentId, write.wasCounted);

  const { commentId, patch } = write;
  return unchanged(
    comments.map((item) =>
      item.id === commentId ? { ...item, ...patch } : item
    )
  );
};

export function applyCommentWrites(
  comments: ScreenshotComment[],
  writes: ScreenshotCommentWrite[],
  sinceVersion: number,
  includeAdds: boolean
) {
  const laterWrites = writes.filter((write) => write.version > sinceVersion);
  let result = comments;
  let netCountDelta = 0;

  for (const write of laterWrites) {
    const applied = applyWrite(result, write, includeAdds);
    result = applied.comments;
    netCountDelta += applied.countDelta;
  }

  return {
    comments: result,
    netCountDelta,
    hasLaterWrites: laterWrites.length > 0,
  };
}
