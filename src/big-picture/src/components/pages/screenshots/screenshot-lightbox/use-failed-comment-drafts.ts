import { create } from "zustand";

interface FailedCommentDraftsState {
  draftsByScreenshotId: Readonly<Record<string, string[]>>;
  push: (screenshotId: string, bodyHtml: string) => void;
  shift: (screenshotId: string) => void;
}

export const useFailedCommentDrafts = create<FailedCommentDraftsState>(
  (set) => ({
    draftsByScreenshotId: {},
    push: (screenshotId, bodyHtml) =>
      set((state) => ({
        draftsByScreenshotId: {
          ...state.draftsByScreenshotId,
          [screenshotId]: [
            ...(state.draftsByScreenshotId[screenshotId] ?? []),
            bodyHtml,
          ],
        },
      })),
    shift: (screenshotId) =>
      set((state) => {
        const drafts = state.draftsByScreenshotId[screenshotId];
        if (!drafts) return state;

        const { [screenshotId]: _applied, ...rest } =
          state.draftsByScreenshotId;
        const remaining = drafts.slice(1);
        return {
          draftsByScreenshotId:
            remaining.length > 0
              ? { ...rest, [screenshotId]: remaining }
              : rest,
        };
      }),
  })
);
