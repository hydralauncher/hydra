import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ScreenshotLightbox,
  ScreenshotLightboxModals,
  ScreenshotStage,
  getScreenshotGameTitle,
  toScreenshotGalleryItem,
  useLightboxModals,
  type ScreenshotCollection,
} from "@renderer/components/screenshots";
import { ScreenshotLightboxPanel } from "@renderer/components/screenshots/screenshot-lightbox-panel";
import { useScreenshotReviewDrafts } from "@renderer/components/screenshot-upload-form/use-screenshot-review-drafts";
import { useDate } from "@renderer/hooks";
import {
  GalleryLightbox,
  GalleryLightboxImage,
} from "@renderer/pages/game-details/gallery-slider/gallery-lightbox";
import type { GalleryMediaItem } from "@renderer/pages/game-details/gallery-slider/gallery-slider";
import { toLocalScreenshotUrl } from "@shared";
import type { LocalScreenshot } from "@types";

import { LocalScreenshotLightboxPanel } from "./local-screenshot-lightbox-panel";
import {
  getMyScreenshotsEntryKey,
  type MyScreenshotsEntry,
} from "./my-screenshots-entries";

interface MyScreenshotsLightboxProps {
  collection: ScreenshotCollection;
  entries: MyScreenshotsEntry[];
  openLocal: LocalScreenshot | null;
  describeLocal: (screenshot: LocalScreenshot) => string;
  onOpenEntry: (entry: MyScreenshotsEntry) => void;
  onClose: () => void;
}

function usePastEndAdvance(
  entries: MyScreenshotsEntry[],
  currentKey: string | null,
  feed: ScreenshotCollection["feed"],
  onOpenEntry: (entry: MyScreenshotsEntry) => void
) {
  const [pendingFromKey, setPendingFromKey] = useState<string | null>(null);
  const { loadMore, hasMore, isLoading, hasLoadMoreFailed } = feed;

  useEffect(() => {
    if (!pendingFromKey) return;
    if (pendingFromKey !== currentKey) {
      setPendingFromKey(null);
      return;
    }

    const fromIndex = entries.findIndex(
      (entry) => getMyScreenshotsEntryKey(entry) === pendingFromKey
    );
    const nextEntry = fromIndex >= 0 ? entries[fromIndex + 1] : undefined;
    if (nextEntry) {
      setPendingFromKey(null);
      onOpenEntry(nextEntry);
      return;
    }

    if (fromIndex < 0 || hasLoadMoreFailed || (!hasMore && !isLoading)) {
      setPendingFromKey(null);
    }
  }, [
    currentKey,
    entries,
    hasLoadMoreFailed,
    hasMore,
    isLoading,
    onOpenEntry,
    pendingFromKey,
  ]);

  return useCallback(
    (fromKey: string) => {
      setPendingFromKey(fromKey);
      void loadMore();
    },
    [loadMore]
  );
}

export function MyScreenshotsLightbox({
  collection,
  entries,
  openLocal,
  describeLocal,
  onOpenEntry,
  onClose,
}: Readonly<MyScreenshotsLightboxProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDate } = useDate();
  const { feed, actions, onPatch, lightbox } = collection;
  const modals = useLightboxModals(onClose);

  const uploadedScreenshot =
    lightbox.status === "ready" ? lightbox.screenshot : null;
  const currentEntry: MyScreenshotsEntry | null = useMemo(() => {
    if (openLocal) {
      return {
        kind: "local",
        time: openLocal.capturedAt,
        screenshot: openLocal,
      };
    }
    if (uploadedScreenshot) {
      return {
        kind: "uploaded",
        time: uploadedScreenshot.capturedAt,
        screenshot: uploadedScreenshot,
      };
    }
    return null;
  }, [openLocal, uploadedScreenshot]);

  const currentKey = currentEntry
    ? getMyScreenshotsEntryKey(currentEntry)
    : null;
  const listIndex = currentKey
    ? entries.findIndex(
        (entry) => getMyScreenshotsEntryKey(entry) === currentKey
      )
    : -1;
  const isInList = listIndex >= 0;

  const viewerEntries = useMemo(() => {
    if (!currentEntry) return [];
    if (!isInList) return [currentEntry];
    return entries.map((entry) =>
      getMyScreenshotsEntryKey(entry) === currentKey ? currentEntry : entry
    );
  }, [currentEntry, currentKey, entries, isInList]);

  const localScreenshots = useMemo(
    () =>
      viewerEntries.flatMap((entry) =>
        entry.kind === "local" ? [entry.screenshot] : []
      ),
    [viewerEntries]
  );
  const { getDraft, updateDraft, flushDrafts } =
    useScreenshotReviewDrafts(localScreenshots);

  const entriesByKey = useMemo(
    () =>
      new Map(
        viewerEntries.map((entry) => [getMyScreenshotsEntryKey(entry), entry])
      ),
    [viewerEntries]
  );

  const galleryItems = useMemo<GalleryMediaItem[]>(
    () =>
      viewerEntries.map((entry) => {
        const id = getMyScreenshotsEntryKey(entry);
        if (entry.kind === "local") {
          return {
            id,
            type: "image",
            src: toLocalScreenshotUrl(entry.screenshot.path),
            thumbnail: toLocalScreenshotUrl(
              entry.screenshot.previewPath ?? entry.screenshot.path
            ),
            alt: describeLocal(entry.screenshot),
          };
        }
        const alt = t("screenshot_alt", {
          game: getScreenshotGameTitle(entry.screenshot, t),
          date: formatDate(entry.screenshot.capturedAt),
        });
        return { ...toScreenshotGalleryItem(entry.screenshot, alt), id };
      }),
    [describeLocal, formatDate, t, viewerEntries]
  );

  const advancePastEnd = usePastEndAdvance(
    entries,
    currentKey,
    feed,
    onOpenEntry
  );

  const handleClose = () => {
    flushDrafts();
    modals.handleClose();
  };

  if (!currentEntry && lightbox.status !== "closed") {
    return <ScreenshotLightbox collection={collection} />;
  }

  if (!currentEntry || !currentKey) return null;

  return (
    <>
      <GalleryLightbox
        visible
        items={galleryItems}
        index={Math.max(listIndex, 0)}
        showFilmstrip={false}
        showCounter={false}
        trapFocus
        hasMoreAfter={
          isInList &&
          listIndex === entries.length - 1 &&
          feed.hasMore &&
          !feed.hasLoadMoreFailed
        }
        onNavigatePastEnd={() => advancePastEnd(currentKey)}
        renderImage={(item, context) => {
          const entry = entriesByKey.get(item.id);
          if (!entry) return null;

          if (entry.kind === "local") {
            return (
              <GalleryLightboxImage
                key={item.id}
                item={item}
                imageClassName="screenshot-stage__image"
                onImageError={context.onReady}
                {...context}
              />
            );
          }

          return (
            <ScreenshotStage
              key={item.id}
              screenshot={entry.screenshot}
              item={item}
              context={context}
              onImageError={lightbox.refreshScreenshot}
            />
          );
        }}
        getCaption={(item, { isSidebarOpen }) =>
          isSidebarOpen
            ? null
            : (entriesByKey.get(item.id)?.screenshot.description ?? null)
        }
        renderSidebar={() =>
          currentEntry.kind === "local" ? (
            <LocalScreenshotLightboxPanel
              key={currentKey}
              screenshot={currentEntry.screenshot}
              draft={getDraft(currentEntry.screenshot)}
              onDraftChange={(draft) =>
                updateDraft(currentEntry.screenshot.clientId, draft)
              }
              onDraftCommit={flushDrafts}
            />
          ) : (
            <ScreenshotLightboxPanel
              screenshot={currentEntry.screenshot}
              actions={actions}
              onPatch={onPatch}
              onFailure={lightbox.markFailure}
              onClose={handleClose}
              onRequestManage={modals.showManageModal}
              onRequestDelete={modals.showDeleteConfirmation}
              onRequestReport={modals.showReportModal}
            />
          )
        }
        onClose={handleClose}
        onNavigate={(nextIndex) => {
          const nextEntry = viewerEntries[nextIndex];
          if (!nextEntry) return;
          flushDrafts();
          onOpenEntry(nextEntry);
        }}
      />

      {currentEntry.kind === "uploaded" ? (
        <ScreenshotLightboxModals
          screenshot={currentEntry.screenshot}
          actions={actions}
          isDeleteConfirmationVisible={modals.isDeleteConfirmationVisible}
          isReportModalVisible={modals.isReportModalVisible}
          isManageModalVisible={modals.isManageModalVisible}
          onCloseDeleteConfirmation={modals.hideDeleteConfirmation}
          onCloseReportModal={modals.hideReportModal}
          onCloseManageModal={modals.hideManageModal}
          onDeleted={handleClose}
        />
      ) : null}
    </>
  );
}
