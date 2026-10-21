import type { ScreenshotComment } from "@types";

export type ScreenshotCommentWriteInput =
  | { kind: "add"; comment: ScreenshotComment }
  | { kind: "patch"; commentId: string; patch: Partial<ScreenshotComment> }
  | { kind: "remove"; commentId: string; wasCounted: boolean };

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

    if (write.kind === "add") {
      if (!includeAdds) continue;
      if (result.some((comment) => comment.id === write.comment.id)) continue;

      result = [write.comment, ...result];
      netCountDelta += 1;
      continue;
    }

    if (write.kind === "remove") {
      const next = result.filter((comment) => comment.id !== write.commentId);
      if (write.wasCounted) netCountDelta -= result.length - next.length;
      result = next;
      continue;
    }

    const { commentId, patch } = write;
    result = result.map((comment) =>
      comment.id === commentId ? { ...comment, ...patch } : comment
    );
  }

  return { comments: result, netCountDelta, hasLaterWrites };
}
