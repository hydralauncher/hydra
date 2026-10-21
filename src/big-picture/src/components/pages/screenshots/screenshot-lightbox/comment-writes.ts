import type { ScreenshotComment } from "@types";

export type ScreenshotCommentWriteInput =
  | { kind: "add"; comment: ScreenshotComment }
  | { kind: "patch"; commentId: string; patch: Partial<ScreenshotComment> }
  | { kind: "remove"; commentId: string; wasCounted: boolean };

const getCountDelta = (write: ScreenshotCommentWriteInput) => {
  if (write.kind === "add") return 1;
  if (write.kind === "remove" && write.wasCounted) return -1;

  return 0;
};

export type ScreenshotCommentWrite = ScreenshotCommentWriteInput & {
  version: number;
};

export function applyCommentWrites(
  comments: ScreenshotComment[],
  writes: ScreenshotCommentWrite[],
  sinceVersion: number,
  includeAdds: boolean
) {
  let result = comments;
  let netCountDelta = 0;
  let hasLaterWrites = false;

  for (const write of writes) {
    if (write.version <= sinceVersion) continue;
    hasLaterWrites = true;
    netCountDelta += getCountDelta(write);

    if (write.kind === "add") {
      if (!includeAdds) continue;
      if (result.some((comment) => comment.id === write.comment.id)) continue;

      result = [write.comment, ...result];
      continue;
    }

    if (write.kind === "remove") {
      result = result.filter((comment) => comment.id !== write.commentId);
      continue;
    }

    const { commentId, patch } = write;
    result = result.map((comment) =>
      comment.id === commentId ? { ...comment, ...patch } : comment
    );
  }

  return { comments: result, netCountDelta, hasLaterWrites };
}
