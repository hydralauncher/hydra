import { useCallback, useEffect, useState } from "react";

import type { ScreenshotCollection } from "@renderer/components/screenshots";
import type { LocalScreenshot, ProfileScreenshot } from "@types";

import type { MyScreenshotsEntry } from "./my-screenshots-entries";
import type { LocalScreenshotUploadStatus } from "./use-local-screenshot-actions";

interface UseMyScreenshotsViewerOptions {
  lightbox: ScreenshotCollection["lightbox"];
  localScreenshots: LocalScreenshot[];
  hasLocalLoaded: boolean;
  uploadedItems: ProfileScreenshot[];
  getUploadStatus: (
    screenshot: LocalScreenshot
  ) => LocalScreenshotUploadStatus | null;
}

const withUploadStatus = (
  screenshot: LocalScreenshot,
  status: LocalScreenshotUploadStatus | null
): LocalScreenshot =>
  status
    ? { ...screenshot, state: status.state, uploadProgress: status.progress }
    : screenshot;

export function useMyScreenshotsViewer({
  lightbox,
  localScreenshots,
  hasLocalLoaded,
  uploadedItems,
  getUploadStatus,
}: UseMyScreenshotsViewerOptions) {
  const [openLocalId, setOpenLocalId] = useState<string | null>(null);
  const { open: openUploaded, close: closeUploaded } = lightbox;

  const openLocalSource = openLocalId
    ? (localScreenshots.find(
        (screenshot) => screenshot.clientId === openLocalId
      ) ?? null)
    : null;
  const openLocal = openLocalSource
    ? withUploadStatus(openLocalSource, getUploadStatus(openLocalSource))
    : null;
  const uploadedFromLocal =
    openLocalSource?.state === "uploaded" && openLocalSource.screenshotId
      ? uploadedItems.find((item) => item.id === openLocalSource.screenshotId)
      : undefined;

  useEffect(() => {
    if (!openLocalId) return;
    if (uploadedFromLocal) {
      setOpenLocalId(null);
      openUploaded(uploadedFromLocal);
      return;
    }
    if (hasLocalLoaded && !openLocalSource) setOpenLocalId(null);
  }, [
    hasLocalLoaded,
    openLocalId,
    openLocalSource,
    openUploaded,
    uploadedFromLocal,
  ]);

  const openEntry = useCallback(
    (entry: MyScreenshotsEntry) => {
      if (entry.kind === "local") {
        closeUploaded();
        setOpenLocalId(entry.screenshot.clientId);
        return;
      }
      setOpenLocalId(null);
      openUploaded(entry.screenshot);
    },
    [closeUploaded, openUploaded]
  );

  const close = useCallback(() => {
    setOpenLocalId(null);
    closeUploaded();
  }, [closeUploaded]);

  return { openLocal, openEntry, close };
}
