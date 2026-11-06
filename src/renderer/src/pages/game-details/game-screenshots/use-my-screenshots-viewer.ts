import { useCallback, useEffect, useState } from "react";

import type { ScreenshotCollection } from "@renderer/components/screenshots";
import { useUserDetails } from "@renderer/hooks";
import type { LocalScreenshot, ProfileScreenshot } from "@types";

import type { MyScreenshotsEntry } from "./my-screenshots-entries";
import type { LocalScreenshotUploadStatus } from "./use-local-screenshot-actions";

interface UseMyScreenshotsViewerOptions {
  lightbox: ScreenshotCollection["lightbox"];
  feed: ScreenshotCollection["feed"];
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

interface SeenUpload {
  clientId: string;
  requestId: number;
}

export function useMyScreenshotsViewer({
  lightbox,
  feed,
  localScreenshots,
  hasLocalLoaded,
  uploadedItems,
  getUploadStatus,
}: UseMyScreenshotsViewerOptions) {
  const [openLocalId, setOpenLocalId] = useState<string | null>(null);
  const [seenUpload, setSeenUpload] = useState<SeenUpload | null>(null);
  const { userDetails } = useUserDetails();
  const ownerId = userDetails?.id ?? null;
  const {
    open: openUploaded,
    openById: openUploadedById,
    close: closeUploaded,
  } = lightbox;
  const { loadedRequestId, getLatestRequestId } = feed;

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
  const publishedIdFromLocal =
    openLocalSource?.state === "uploaded" &&
    openLocalSource.moderationStatus !== "BLOCKED"
      ? (openLocalSource.screenshotId ?? null)
      : null;
  const hasFeedLoadedSinceUpload =
    seenUpload !== null &&
    seenUpload.clientId === openLocalId &&
    loadedRequestId > seenUpload.requestId;

  useEffect(() => {
    if (!openLocalId || !publishedIdFromLocal) return;
    if (seenUpload?.clientId === openLocalId) return;
    setSeenUpload({ clientId: openLocalId, requestId: getLatestRequestId() });
  }, [getLatestRequestId, openLocalId, publishedIdFromLocal, seenUpload]);

  useEffect(() => {
    if (!openLocalId) return;
    if (uploadedFromLocal) {
      setOpenLocalId(null);
      openUploaded(uploadedFromLocal);
      return;
    }
    if (publishedIdFromLocal && ownerId && hasFeedLoadedSinceUpload) {
      setOpenLocalId(null);
      openUploadedById(ownerId, publishedIdFromLocal);
      return;
    }
    if (hasLocalLoaded && !openLocalSource) setOpenLocalId(null);
  }, [
    hasFeedLoadedSinceUpload,
    hasLocalLoaded,
    openLocalId,
    openLocalSource,
    openUploaded,
    openUploadedById,
    ownerId,
    publishedIdFromLocal,
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
