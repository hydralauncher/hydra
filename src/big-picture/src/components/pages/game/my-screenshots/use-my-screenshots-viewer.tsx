import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalScreenshot, ProfileScreenshot } from "@types";
import {
  normalizeScreenshotDescription,
  resolveScreenshotPreferences,
} from "@shared";

import {
  createReviewDraft,
  type ReviewDraft,
} from "../../../screenshot-upload-form/review-fields";
import { useReviewDraftSave } from "../../../screenshot-upload-form/use-review-draft-save";
import { useUserPreferences } from "../../../../hooks";
import type {
  ScreenshotLightboxLocalSlot,
  ScreenshotViewerEntry,
} from "../../screenshots";
import {
  LocalScreenshotSidebar,
  getLocalScreenshotSidebarEntryFocusId,
} from "./local-screenshot-sidebar";

interface SavedDraftRecord {
  record: LocalScreenshot;
  replaces: LocalScreenshot | undefined;
}

interface UseMyScreenshotsViewerOptions {
  entries: ScreenshotViewerEntry[];
  localScreenshots: LocalScreenshot[];
  hasLocalLoaded: boolean;
  uploadedItems: ProfileScreenshot[];
  canResolveUploaded: boolean;
  openUploaded: (screenshot: ProfileScreenshot) => void;
  closeUploaded: () => void;
  getFocusAfterLocalDeleteId?: (screenshot: LocalScreenshot) => string | null;
}

export function useMyScreenshotsViewer({
  entries,
  localScreenshots,
  hasLocalLoaded,
  uploadedItems,
  canResolveUploaded,
  openUploaded,
  closeUploaded,
  getFocusAfterLocalDeleteId,
}: UseMyScreenshotsViewerOptions) {
  const userPreferences = useUserPreferences();
  const defaultVisibility =
    resolveScreenshotPreferences(userPreferences).defaultVisibility;
  const [openLocalId, setOpenLocalId] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<
    Record<string, Partial<ReviewDraft>>
  >({});
  const [savedRecords, setSavedRecords] = useState<
    Record<string, SavedDraftRecord>
  >({});
  const localScreenshotsRef = useRef(localScreenshots);
  localScreenshotsRef.current = localScreenshots;
  const dropSavedDraftEdits = useCallback(
    (clientId: string, record: LocalScreenshot | null) => {
      if (record) {
        const replaces = localScreenshotsRef.current.find(
          (screenshot) => screenshot.clientId === clientId
        );
        setSavedRecords((existing) => ({
          ...existing,
          [clientId]: { record, replaces },
        }));
      }
      setDraftEdits((existing) => {
        if (!existing[clientId]) return existing;

        const { [clientId]: _saved, ...rest } = existing;
        return rest;
      });
    },
    []
  );

  useEffect(() => {
    setSavedRecords((existing) => {
      const stillPending = Object.entries(existing).filter(
        ([clientId, saved]) =>
          localScreenshots.find(
            (screenshot) => screenshot.clientId === clientId
          ) === saved.replaces
      );
      return stillPending.length === Object.keys(existing).length
        ? existing
        : Object.fromEntries(stillPending);
    });
  }, [localScreenshots]);
  const {
    schedule: scheduleDraftSave,
    cancel: cancelDraftSave,
    flushAll: flushDraftSaves,
  } = useReviewDraftSave(dropSavedDraftEdits);

  const openLocal = openLocalId
    ? (localScreenshots.find(
        (screenshot) => screenshot.clientId === openLocalId
      ) ?? null)
    : null;
  const uploadedFromLocal =
    openLocal?.state === "uploaded" && openLocal.screenshotId
      ? uploadedItems.find((item) => item.id === openLocal.screenshotId)
      : undefined;
  const isUploadedOutsideFeed =
    !canResolveUploaded &&
    openLocal?.state === "uploaded" &&
    openLocal.moderationStatus !== "BLOCKED";

  useEffect(() => {
    if (!openLocalId) return;
    if (uploadedFromLocal) {
      setOpenLocalId(null);
      openUploaded(uploadedFromLocal);
      return;
    }
    if (isUploadedOutsideFeed || (hasLocalLoaded && !openLocal)) {
      setOpenLocalId(null);
    }
  }, [
    hasLocalLoaded,
    isUploadedOutsideFeed,
    openLocal,
    openLocalId,
    openUploaded,
    uploadedFromLocal,
  ]);

  const openEntry = useCallback(
    (entry: ScreenshotViewerEntry) => {
      flushDraftSaves();
      if (entry.kind === "local") {
        closeUploaded();
        setOpenLocalId(entry.screenshot.clientId);
        return;
      }
      setOpenLocalId(null);
      openUploaded(entry.screenshot);
    },
    [closeUploaded, flushDraftSaves, openUploaded]
  );

  const close = useCallback(() => {
    flushDraftSaves();
    setOpenLocalId(null);
    closeUploaded();
  }, [closeUploaded, flushDraftSaves]);

  const getDraft = useCallback(
    (screenshot: LocalScreenshot): ReviewDraft => {
      const saved = savedRecords[screenshot.clientId];
      const record = saved?.replaces === screenshot ? saved.record : screenshot;
      return {
        ...createReviewDraft(record, defaultVisibility),
        ...draftEdits[screenshot.clientId],
      };
    },
    [defaultVisibility, draftEdits, savedRecords]
  );

  const updateDraft = useCallback(
    (screenshot: LocalScreenshot, update: Partial<ReviewDraft>) => {
      const nextDraft = { ...getDraft(screenshot), ...update };
      setDraftEdits((existing) => ({
        ...existing,
        [screenshot.clientId]: { ...existing[screenshot.clientId], ...update },
      }));
      scheduleDraftSave(screenshot.clientId, {
        isSpoiler: nextDraft.isSpoiler,
        visibility: nextDraft.visibility,
        commentsEnabled: nextDraft.commentsEnabled,
        customGameTitle: nextDraft.customGameTitle.trim() || null,
        description: normalizeScreenshotDescription(nextDraft.description),
      });
    },
    [getDraft, scheduleDraftSave]
  );

  const localSlot = useMemo<ScreenshotLightboxLocalSlot>(
    () => ({
      entries,
      openLocal,
      onOpenEntry: openEntry,
      onClose: close,
      getSidebarEntryFocusId: getLocalScreenshotSidebarEntryFocusId,
      renderSidebar: (screenshot, stageTarget) => (
        <LocalScreenshotSidebar
          key={screenshot.clientId}
          screenshot={screenshot}
          draft={getDraft(screenshot)}
          stageTarget={stageTarget}
          focusAfterDeleteId={getFocusAfterLocalDeleteId?.(screenshot) ?? null}
          onDraftChange={(update) => updateDraft(screenshot, update)}
          onBeforeUpload={() => cancelDraftSave(screenshot.clientId)}
        />
      ),
    }),
    [
      cancelDraftSave,
      close,
      entries,
      getDraft,
      getFocusAfterLocalDeleteId,
      openEntry,
      openLocal,
      updateDraft,
    ]
  );

  return { localSlot, openEntry };
}
