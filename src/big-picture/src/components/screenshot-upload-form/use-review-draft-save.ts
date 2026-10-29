import { useCallback, useEffect, useRef } from "react";
import type { LocalScreenshot, LocalScreenshotDraft } from "@types";
import { logger } from "@renderer/logger";

const DRAFT_SAVE_DELAY_MS = 400;

interface PendingDraft {
  timer: ReturnType<typeof setTimeout>;
  draft: LocalScreenshotDraft;
}

export function useReviewDraftSave(
  onSaved?: (clientId: string, record: LocalScreenshot | null) => void
) {
  const pendingRef = useRef(new Map<string, PendingDraft>());
  const inFlightRef = useRef(new Map<string, number>());
  const onSavedRef = useRef(onSaved);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const settle = useCallback(
    (clientId: string, saved: { record: LocalScreenshot | null } | null) => {
      const remaining = (inFlightRef.current.get(clientId) ?? 1) - 1;
      if (remaining > 0) {
        inFlightRef.current.set(clientId, remaining);
        return;
      }

      inFlightRef.current.delete(clientId);
      if (saved && !pendingRef.current.has(clientId)) {
        onSavedRef.current?.(clientId, saved.record);
      }
    },
    []
  );

  const save = useCallback(
    (clientId: string) => {
      const pending = pendingRef.current.get(clientId);
      if (!pending) return;

      clearTimeout(pending.timer);
      pendingRef.current.delete(clientId);
      inFlightRef.current.set(
        clientId,
        (inFlightRef.current.get(clientId) ?? 0) + 1
      );
      globalThis.window.electron
        .updateLocalScreenshotDraft(clientId, pending.draft)
        .then(
          (record) => settle(clientId, { record }),
          (error: unknown) => {
            logger.error("Failed to save the screenshot draft", error);
            settle(clientId, null);
          }
        );
    },
    [settle]
  );

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
    for (const clientId of pendingRef.current.keys()) save(clientId);
  }, [save]);

  useEffect(() => flushAll, [flushAll]);

  return { schedule, save, cancel, flushAll };
}
