import { useCallback, useSyncExternalStore } from "react";

export interface RestoredCommentDraft {
  key: number;
  body: string;
}

const draftsByScreenshotId = new Map<string, RestoredCommentDraft[]>();
const listeners = new Set<() => void>();
let lastDraftKey = 0;

const notifyListeners = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const queueRestoredCommentDraft = (
  screenshotId: string,
  body: string
) => {
  lastDraftKey += 1;
  const queue = draftsByScreenshotId.get(screenshotId) ?? [];
  draftsByScreenshotId.set(screenshotId, [
    ...queue,
    { key: lastDraftKey, body },
  ]);
  notifyListeners();
};

const shiftRestoredCommentDraft = (screenshotId: string) => {
  const queue = draftsByScreenshotId.get(screenshotId);
  if (!queue) return;

  const remaining = queue.slice(1);
  if (remaining.length > 0) draftsByScreenshotId.set(screenshotId, remaining);
  else draftsByScreenshotId.delete(screenshotId);
  notifyListeners();
};

export function useRestoredCommentDraft(screenshotId: string) {
  const restoredDraft = useSyncExternalStore(
    subscribe,
    () => draftsByScreenshotId.get(screenshotId)?.[0] ?? null
  );
  const clearRestoredDraft = useCallback(
    () => shiftRestoredCommentDraft(screenshotId),
    [screenshotId]
  );

  return { restoredDraft, clearRestoredDraft };
}
