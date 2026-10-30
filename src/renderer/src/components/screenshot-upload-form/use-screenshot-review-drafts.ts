import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalScreenshot } from "@types";
import { logger } from "@renderer/logger";

import {
  createReviewDraft,
  type ScreenshotReviewDraft,
} from "./screenshot-review-state";

const DRAFT_SAVE_DELAY_MS = 300;

export function useScreenshotReviewDrafts(screenshots: LocalScreenshot[]) {
  const [drafts, setDrafts] = useState<Record<string, ScreenshotReviewDraft>>(
    {}
  );
  const draftsRef = useRef(drafts);
  const draftSaveTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  draftsRef.current = drafts;

  useEffect(() => {
    setDrafts((current) => {
      const listedIds = new Set(
        screenshots.map((screenshot) => screenshot.clientId)
      );
      const staleIds = Object.keys(current).filter(
        (clientId) =>
          !listedIds.has(clientId) && !draftSaveTimers.current.has(clientId)
      );
      const missing = screenshots.filter(
        (screenshot) => !current[screenshot.clientId]
      );
      if (!missing.length && !staleIds.length) return current;
      const next = { ...current };
      for (const clientId of staleIds) {
        delete next[clientId];
      }
      for (const screenshot of missing) {
        next[screenshot.clientId] = createReviewDraft(screenshot);
      }
      return next;
    });
  }, [screenshots]);

  const persistDraft = useCallback((clientId: string) => {
    const timer = draftSaveTimers.current.get(clientId);
    if (timer) clearTimeout(timer);
    draftSaveTimers.current.delete(clientId);

    const draft = draftsRef.current[clientId];
    if (!draft) return;

    window.electron
      .updateLocalScreenshotDraft(clientId, {
        isSpoiler: draft.isSpoiler,
        visibility: draft.visibility,
        commentsEnabled: draft.commentsEnabled,
        customGameTitle: draft.customGameTitle,
        description: draft.description,
      })
      .catch((error) => {
        logger.error("Failed to save the screenshot draft", error);
      });
  }, []);

  const flushDrafts = useCallback(() => {
    for (const clientId of draftSaveTimers.current.keys()) {
      persistDraft(clientId);
    }
  }, [persistDraft]);

  const updateDraft = useCallback(
    (clientId: string, draft: ScreenshotReviewDraft) => {
      draftsRef.current = { ...draftsRef.current, [clientId]: draft };
      setDrafts((current) => ({ ...current, [clientId]: draft }));

      const timer = draftSaveTimers.current.get(clientId);
      if (timer) clearTimeout(timer);
      draftSaveTimers.current.set(
        clientId,
        setTimeout(() => persistDraft(clientId), DRAFT_SAVE_DELAY_MS)
      );
    },
    [persistDraft]
  );

  useEffect(() => {
    window.addEventListener("beforeunload", flushDrafts);
    return () => {
      window.removeEventListener("beforeunload", flushDrafts);
      flushDrafts();
    };
  }, [flushDrafts]);

  const getDraft = useCallback(
    (screenshot: LocalScreenshot) =>
      drafts[screenshot.clientId] ?? createReviewDraft(screenshot),
    [drafts]
  );

  return { getDraft, updateDraft, flushDrafts };
}
