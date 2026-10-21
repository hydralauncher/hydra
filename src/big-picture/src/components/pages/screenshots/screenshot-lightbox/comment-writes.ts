import type { ScreenshotComment } from "@types";

export type ScreenshotCommentWriteInput =
  | { kind: "add"; comment: ScreenshotComment }
  | { kind: "patch"; commentId: string; patch: Partial<ScreenshotComment> }
  | { kind: "remove"; commentId: string };

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
  let totalDelta = 0;

  for (const write of writes) {
    if (write.version <= sinceVersion) continue;

    if (write.kind === "add") {
      if (!includeAdds) continue;
      if (result.some((comment) => comment.id === write.comment.id)) continue;

      result = [write.comment, ...result];
      totalDelta += 1;
      continue;
    }

    if (write.kind === "remove") {
      const next = result.filter((comment) => comment.id !== write.commentId);
      totalDelta -= result.length - next.length;
      result = next;
      continue;
    }

    const { commentId, patch } = write;
    result = result.map((comment) =>
      comment.id === commentId ? { ...comment, ...patch } : comment
    );
  }

  return { comments: result, totalDelta };
}
