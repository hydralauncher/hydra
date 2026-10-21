import { useCallback, useEffect, useRef } from "react";
import type { LocalScreenshotDraft } from "@types";
import { logger } from "@renderer/logger";

const DRAFT_SAVE_DELAY_MS = 400;

interface PendingDraft {
  timer: ReturnType<typeof setTimeout>;
  draft: LocalScreenshotDraft;
}

export function useReviewDraftSave() {
  const pendingRef = useRef(new Map<string, PendingDraft>());

  const save = useCallback((clientId: string) => {
    const pending = pendingRef.current.get(clientId);
    if (!pending) return;

    clearTimeout(pending.timer);
    pendingRef.current.delete(clientId);
    globalThis.window.electron
      .updateLocalScreenshotDraft(clientId, pending.draft)
      .catch((error: unknown) => {
        logger.error("Failed to save the screenshot draft", error);
      });
  }, []);

  const schedule = useCallback(
    (clientId: string, draft: LocalScreenshotDraft) => {
      const existing = pendingRef.current.get(clientId);
      if (existing) clearTimeout(existing.timer);

      pendingRef.current.set(clientId, {
        draft,
        timer: setTimeout(() => save(clientId), DRAFT_SAVE_DELAY_MS),
      });
    },
    [save]
  );

  const cancel = useCallback((clientId: string) => {
    const pending = pendingRef.current.get(clientId);
    if (pending) clearTimeout(pending.timer);
    pendingRef.current.delete(clientId);
  }, []);

  const flushAll = useCallback(() => {
    for (const clientId of [...pendingRef.current.keys()]) save(clientId);
  }, [save]);

  useEffect(() => flushAll, [flushAll]);

  return { schedule, save, cancel, flushAll };
}
