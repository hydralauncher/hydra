import { create } from "zustand";

interface FailedCommentDraftsState {
  draftsByKey: Readonly<Record<string, string[]>>;
  push: (draftKey: string, bodyHtml: string) => void;
  shift: (draftKey: string) => void;
}

export const useFailedCommentDrafts = create<FailedCommentDraftsState>(
  (set) => ({
    draftsByKey: {},
    push: (draftKey, bodyHtml) =>
      set((state) => ({
        draftsByKey: {
          ...state.draftsByKey,
          [draftKey]: [...(state.draftsByKey[draftKey] ?? []), bodyHtml],
        },
      })),
    shift: (draftKey) =>
      set((state) => {
        const drafts = state.draftsByKey[draftKey];
        if (!drafts) return state;

        const { [draftKey]: _applied, ...rest } = state.draftsByKey;
        const remaining = drafts.slice(1);
        return {
          draftsByKey:
            remaining.length > 0 ? { ...rest, [draftKey]: remaining } : rest,
        };
      }),
  })
);
