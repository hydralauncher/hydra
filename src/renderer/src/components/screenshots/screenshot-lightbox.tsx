import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertIcon,
  EyeClosedIcon,
  ImageIcon,
  LockIcon,
  ShieldIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { Button } from "../button/button";
import { ConfirmationModal } from "../confirmation-modal/confirmation-modal";
import {
  GalleryLightbox,
  GalleryLightboxImage,
  type GalleryImageRenderContext,
} from "@renderer/pages/game-details/gallery-slider/gallery-lightbox";
import type { GalleryMediaItem } from "@renderer/pages/game-details/gallery-slider/gallery-slider";
import { useDate } from "@renderer/hooks";
import { useScreenshotImageFallback } from "@shared";
import type { ProfileScreenshot } from "@types";

import { ProgressiveScreenshotImage } from "./progressive-screenshot-image";
import { ScreenshotLightboxPanel } from "./screenshot-lightbox-panel";
import { ScreenshotManageModal } from "./screenshot-manage-modal";
import { ScreenshotReportModal } from "./screenshot-report-modal";
import { getScreenshotGameTitle } from "./screenshot-labels";
import type {
  ScreenshotCollection,
  ScreenshotLightboxStatus,
} from "./use-screenshot-collection";
import { SensitiveScreenshotModal } from "./sensitive-screenshot-modal";
import { useScreenshotSpoiler } from "./use-screenshot-spoiler";
import { useSensitiveScreenshotConfirmation } from "./use-sensitive-screenshot";

import "./screenshot-lightbox.scss";

type ScreenshotPlaceholderStatus = Exclude<
  ScreenshotLightboxStatus,
  "closed" | "ready"
>;

type ThumbnailFallback = "none" | "active" | "failed";

interface ScreenshotStageProps {
  screenshot: ProfileScreenshot;
  item: GalleryMediaItem;
  context: GalleryImageRenderContext;
  onImageError: (screenshot: ProfileScreenshot) => Promise<void>;
}

export function ScreenshotStage({
  screenshot,
  item,
  context,
  onImageError,
}: Readonly<ScreenshotStageProps>) {
  const { t } = useTranslation("screenshots");
  const { isHidden: isSpoilerHidden, reveal } =
    useScreenshotSpoiler(screenshot);
  const sensitive = useSensitiveScreenshotConfirmation(screenshot);
  const { hasImage, isRefreshing, handleImageError } =
    useScreenshotImageFallback(screenshot.imageUrl, () =>
      onImageError(screenshot)
    );
  const [thumbnailFallback, setThumbnailFallback] =
    useState<ThumbnailFallback>("none");
  const isShowingThumbnail =
    !hasImage &&
    thumbnailFallback === "active" &&
    Boolean(screenshot.thumbnailUrl);
  const onReadyRef = useRef(context.onReady);
  onReadyRef.current = context.onReady;

  useEffect(() => {
    if (!hasImage) onReadyRef.current();
  }, [hasImage]);

  if (!hasImage && !isShowingThumbnail) {
    return (
      <div
        className="screenshot-stage__placeholder"
        role="img"
        aria-label={item.alt}
      >
        <ImageIcon size={48} />
        <span>
          {isRefreshing ? t("loading_screenshot") : t("image_unavailable")}
        </span>
      </div>
    );
  }

  return (
    <>
      <GalleryLightboxImage
        item={{ ...item, src: screenshot.imageUrl ?? undefined }}
        onImageError={() => void handleImageError()}
        renderMedia={(handlers) => (
          <ProgressiveScreenshotImage
            className={cn(
              "gallery-lightbox__image",
              "screenshot-stage__image",
              {
                "screenshot-stage__image--spoiler":
                  sensitive.isHidden || isSpoilerHidden,
              }
            )}
            fit="contain"
            thumbHash={screenshot.thumbHash}
            sources={
              isShowingThumbnail
                ? [screenshot.thumbnailUrl]
                : [screenshot.thumbnailUrl, screenshot.imageUrl]
            }
            alt={item.alt}
            onBestLayerLoad={(image) => {
              if (screenshot.width > 0 && screenshot.height > 0) {
                handlers.onAspectRatioReady(
                  screenshot.width / screenshot.height
                );
                return;
              }
              handlers.onImageLoad(image);
            }}
            onError={(hasLoadedLowerSource) => {
              if (isShowingThumbnail) {
                setThumbnailFallback("failed");
                return;
              }
              if (hasLoadedLowerSource && thumbnailFallback !== "failed") {
                setThumbnailFallback("active");
                void handleImageError();
                return;
              }
              handlers.onImageError();
            }}
            onDoubleClick={handlers.onDoubleClick}
          />
        )}
        {...context}
      >
        {sensitive.isHidden ? (
          <button
            type="button"
            className="screenshot-stage__spoiler"
            onClick={() => sensitive.requestReveal()}
          >
            <ShieldIcon size={24} />
            <span>{t("sensitive_content")}</span>
          </button>
        ) : null}
        {!sensitive.isHidden && isSpoilerHidden ? (
          <button
            type="button"
            className="screenshot-stage__spoiler"
            onClick={reveal}
          >
            <EyeClosedIcon size={24} />
            <span>{t("spoiler_reveal")}</span>
          </button>
        ) : null}
      </GalleryLightboxImage>

      <SensitiveScreenshotModal {...sensitive.modalProps} />
    </>
  );
}

interface ScreenshotStateStageProps {
  status: ScreenshotPlaceholderStatus;
  context: GalleryImageRenderContext;
  onClose: () => void;
}

function ScreenshotStateStage({
  status,
  context,
  onClose,
}: Readonly<ScreenshotStateStageProps>) {
  const { t } = useTranslation("screenshots");
  const onReadyRef = useRef(context.onReady);
  onReadyRef.current = context.onReady;
  const content = {
    loading: { icon: <ImageIcon size={32} />, text: t("loading_screenshot") },
    private: { icon: <LockIcon size={32} />, text: t("screenshot_private") },
    unavailable: {
      icon: <AlertIcon size={32} />,
      text: t("screenshot_unavailable"),
    },
  }[status];

  useEffect(() => {
    onReadyRef.current();
  }, []);

  return (
    <output className="screenshot-lightbox__state">
      <span className="screenshot-lightbox__state-icon">{content.icon}</span>
      <p>{content.text}</p>
      {status === "loading" ? null : (
        <Button theme="outline" onClick={onClose}>
          {t("close")}
        </Button>
      )}
    </output>
  );
}

interface ScreenshotLightboxModalsProps {
  screenshot: ProfileScreenshot;
  actions: ScreenshotCollection["actions"];
  isDeleteConfirmationVisible: boolean;
  isReportModalVisible: boolean;
  isManageModalVisible: boolean;
  onCloseDeleteConfirmation: () => void;
  onCloseReportModal: () => void;
  onCloseManageModal: () => void;
  onDeleted: () => void;
}

export function ScreenshotLightboxModals({
  screenshot,
  actions,
  isDeleteConfirmationVisible,
  isReportModalVisible,
  isManageModalVisible,
  onCloseDeleteConfirmation,
  onCloseReportModal,
  onCloseManageModal,
  onDeleted,
}: Readonly<ScreenshotLightboxModalsProps>) {
  const { t } = useTranslation("screenshots");

  const handleDeleteConfirm = async () => {
    const wasDeleted = await actions.deleteScreenshot(screenshot);
    if (wasDeleted) onDeleted();
  };

  return (
    <>
      <ConfirmationModal
        visible={isDeleteConfirmationVisible}
        title={t("delete_screenshot_title")}
        descriptionText={t("delete_screenshot_description")}
        confirmButtonLabel={t("delete")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        buttonsIsDisabled={actions.deletingIds.has(screenshot.id)}
        onConfirm={() => void handleDeleteConfirm()}
        onClose={onCloseDeleteConfirmation}
      />

      <ScreenshotReportModal
        visible={isReportModalVisible}
        isSubmitting={actions.reportingIds.has(screenshot.id)}
        onClose={onCloseReportModal}
        onSubmit={(values) => actions.reportScreenshot(screenshot, values)}
      />

      <ScreenshotManageModal
        visible={isManageModalVisible}
        screenshot={screenshot}
        isSaving={actions.updatingIds.has(screenshot.id)}
        onClose={onCloseManageModal}
        onSave={(update) => actions.updateScreenshot(screenshot, update)}
      />
    </>
  );
}

export function useLightboxModals(close: () => void) {
  const [isDeleteConfirmationVisible, setIsDeleteConfirmationVisible] =
    useState(false);
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [isManageModalVisible, setIsManageModalVisible] = useState(false);

  const handleClose = useCallback(() => {
    setIsDeleteConfirmationVisible(false);
    setIsReportModalVisible(false);
    setIsManageModalVisible(false);
    close();
  }, [close]);

  return {
    isDeleteConfirmationVisible,
    isReportModalVisible,
    isManageModalVisible,
    showManageModal: () => setIsManageModalVisible(true),
    hideManageModal: () => setIsManageModalVisible(false),
    showDeleteConfirmation: () => setIsDeleteConfirmationVisible(true),
    hideDeleteConfirmation: () => setIsDeleteConfirmationVisible(false),
    showReportModal: () => setIsReportModalVisible(true),
    hideReportModal: () => setIsReportModalVisible(false),
    handleClose,
  };
}

function usePageAdvance(
  items: ProfileScreenshot[],
  feed: ScreenshotCollection["feed"],
  openId: string | null,
  open: (screenshot: ProfileScreenshot) => void
) {
  const [pendingFromId, setPendingFromId] = useState<string | null>(null);
  const { loadMore, hasMore, isLoading, hasLoadMoreFailed } = feed;

  useEffect(() => {
    if (!pendingFromId) return;
    if (pendingFromId !== openId) {
      setPendingFromId(null);
      return;
    }

    const fromIndex = items.findIndex((item) => item.id === pendingFromId);
    const nextItem = fromIndex >= 0 ? items[fromIndex + 1] : undefined;
    if (nextItem) {
      setPendingFromId(null);
      open(nextItem);
      return;
    }

    if (fromIndex < 0 || hasLoadMoreFailed || (!hasMore && !isLoading)) {
      setPendingFromId(null);
    }
  }, [
    hasLoadMoreFailed,
    hasMore,
    isLoading,
    items,
    open,
    openId,
    pendingFromId,
  ]);

  return useCallback(
    (fromId: string) => {
      setPendingFromId(fromId);
      void loadMore();
    },
    [loadMore]
  );
}

export const toScreenshotGalleryItem = (
  screenshot: ProfileScreenshot,
  alt: string
): GalleryMediaItem => ({
  id: screenshot.id,
  type: "image",
  src: screenshot.imageUrl ?? undefined,
  thumbnail: screenshot.thumbnailUrl ?? undefined,
  alt,
});

interface ScreenshotLightboxProps {
  collection: ScreenshotCollection;
  navigationItems?: ProfileScreenshot[];
}

export function ScreenshotLightbox({
  collection,
  navigationItems,
}: Readonly<ScreenshotLightboxProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDate } = useDate();
  const { feed, actions, onPatch, lightbox } = collection;
  const { status, screenshot, open, close, refreshScreenshot, markFailure } =
    lightbox;
  const modals = useLightboxModals(close);
  const items = navigationItems ?? feed.items;
  const advancePastEnd = usePageAdvance(
    items,
    feed,
    status === "closed" ? null : (screenshot?.id ?? null),
    open
  );
  const readyScreenshot = status === "ready" ? screenshot : null;
  const listIndex = readyScreenshot
    ? items.findIndex((item) => item.id === readyScreenshot.id)
    : -1;
  const isInList = listIndex >= 0;

  const viewerScreenshots = useMemo(() => {
    if (!readyScreenshot) return [];
    if (!isInList) return [readyScreenshot];
    return items.map((item) =>
      item.id === readyScreenshot.id ? readyScreenshot : item
    );
  }, [isInList, items, readyScreenshot]);

  const describe = useCallback(
    (item: ProfileScreenshot) =>
      t("screenshot_alt", {
        game: getScreenshotGameTitle(item, t),
        date: formatDate(item.capturedAt),
      }),
    [formatDate, t]
  );

  const galleryItems = useMemo(
    () =>
      viewerScreenshots.map((item) =>
        toScreenshotGalleryItem(item, describe(item))
      ),
    [describe, viewerScreenshots]
  );

  if (status === "closed") return null;

  if (!readyScreenshot) {
    const placeholderStatus: ScreenshotPlaceholderStatus =
      status === "ready" ? "loading" : status;

    return (
      <GalleryLightbox
        visible
        items={[
          { id: "screenshot-state", type: "image", alt: t("screenshot") },
        ]}
        index={0}
        showFilmstrip={false}
        showCounter={false}
        trapFocus
        getCaption={() => null}
        renderImage={(_item, context) => (
          <ScreenshotStateStage
            status={placeholderStatus}
            context={context}
            onClose={modals.handleClose}
          />
        )}
        onClose={modals.handleClose}
        onNavigate={() => undefined}
      />
    );
  }

  const screenshotsById = new Map(
    viewerScreenshots.map((item) => [item.id, item])
  );

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
          listIndex === items.length - 1 &&
          feed.hasMore &&
          !feed.hasLoadMoreFailed
        }
        onNavigatePastEnd={() => advancePastEnd(readyScreenshot.id)}
        renderImage={(item, context) => {
          const itemScreenshot = screenshotsById.get(item.id);
          if (!itemScreenshot) return null;

          return (
            <ScreenshotStage
              key={item.id}
              screenshot={itemScreenshot}
              item={item}
              context={context}
              onImageError={refreshScreenshot}
            />
          );
        }}
        getCaption={(item, { isSidebarOpen }) =>
          isSidebarOpen
            ? null
            : (screenshotsById.get(item.id)?.description ?? null)
        }
        renderSidebar={() => (
          <ScreenshotLightboxPanel
            screenshot={readyScreenshot}
            actions={actions}
            onPatch={onPatch}
            onFailure={markFailure}
            onClose={modals.handleClose}
            onRequestManage={modals.showManageModal}
            onRequestDelete={modals.showDeleteConfirmation}
            onRequestReport={modals.showReportModal}
          />
        )}
        onClose={modals.handleClose}
        onNavigate={(nextIndex) => {
          const nextScreenshot = viewerScreenshots[nextIndex];
          if (nextScreenshot) open(nextScreenshot);
        }}
      />

      <ScreenshotLightboxModals
        screenshot={readyScreenshot}
        actions={actions}
        isDeleteConfirmationVisible={modals.isDeleteConfirmationVisible}
        isReportModalVisible={modals.isReportModalVisible}
        isManageModalVisible={modals.isManageModalVisible}
        onCloseDeleteConfirmation={modals.hideDeleteConfirmation}
        onCloseReportModal={modals.hideReportModal}
        onCloseManageModal={modals.hideManageModal}
        onDeleted={modals.handleClose}
      />
    </>
  );
}
