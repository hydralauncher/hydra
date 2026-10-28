import { useCallback, useSyncExternalStore } from "react";

export interface RestoredCommentDraft {
  key: number;
  body: string;
}

const draftsByKey = new Map<string, RestoredCommentDraft[]>();
const listeners = new Set<() => void>();
let lastDraftKey = 0;

const notifyListeners = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const queueRestoredCommentDraft = (draftKey: string, body: string) => {
  lastDraftKey += 1;
  const queue = draftsByKey.get(draftKey) ?? [];
  draftsByKey.set(draftKey, [...queue, { key: lastDraftKey, body }]);
  notifyListeners();
};

const shiftRestoredCommentDraft = (draftKey: string) => {
  const queue = draftsByKey.get(draftKey);
  if (!queue) return;

  const remaining = queue.slice(1);
  if (remaining.length > 0) draftsByKey.set(draftKey, remaining);
  else draftsByKey.delete(draftKey);
  notifyListeners();
};

export function useRestoredCommentDraft(draftKey: string) {
  const restoredDraft = useSyncExternalStore(
    subscribe,
    () => draftsByKey.get(draftKey)?.[0] ?? null
  );
  const clearRestoredDraft = useCallback(
    () => shiftRestoredCommentDraft(draftKey),
    [draftKey]
  );

  return { restoredDraft, clearRestoredDraft };
}
