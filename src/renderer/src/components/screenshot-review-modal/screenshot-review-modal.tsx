import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import type { LocalScreenshot, ScreenshotReview } from "@types";
import { Modal } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { GalleryLightbox } from "@renderer/pages/game-details/gallery-slider/gallery-lightbox";
import type { GalleryMediaItem } from "@renderer/pages/game-details/gallery-slider/gallery-slider";
import { logger } from "@renderer/logger";

import { ReviewFilmstrip } from "./review-filmstrip";
import { ScreenshotReviewItem } from "./screenshot-review-item";
import {
  applyUploadProgress,
  getLocalImageSource,
  isScreenshotAwaitingReview,
  isScreenshotUndecided,
  selectReviewScreenshots,
} from "./screenshot-review-state";
import { useScreenshotReviewDrafts } from "./use-screenshot-review-drafts";

import "./screenshot-review-modal.scss";

const closeReview = () => {
  window.electron.closeScreenshotReview().catch((error) => {
    logger.error("Failed to close the screenshot review", error);
  });
};

function useMissingScreenshotsToast() {
  const { t } = useTranslation("screenshots_capture");
  const { showErrorToast } = useToast();

  useEffect(
    () =>
      window.electron.onLocalScreenshotsMissing((count) => {
        if (document.visibilityState !== "visible") return;
        showErrorToast(
          t("missing_files_title"),
          t("missing_files_body", { count })
        );
      }),
    [showErrorToast, t]
  );
}

export function ScreenshotReviewModal() {
  const [review, setReview] = useState<ScreenshotReview | null>(null);
  useMissingScreenshotsToast();

  useEffect(() => {
    let active = true;
    let hasLiveReview = false;

    const unsubscribe = window.electron.onScreenshotReviewChanged(
      (nextReview) => {
        hasLiveReview = true;
        setReview(nextReview);
      }
    );

    window.electron
      .getScreenshotReview()
      .then((currentReview) => {
        if (active && !hasLiveReview) setReview(currentReview);
      })
      .catch((error) => {
        logger.error("Failed to load the screenshot review", error);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!review) return null;

  return <ScreenshotReviewContent review={review} />;
}

interface ScreenshotReviewContentProps {
  review: ScreenshotReview;
}

function ScreenshotReviewContent({
  review,
}: Readonly<ScreenshotReviewContentProps>) {
  const { t } = useTranslation("screenshots_capture");

  const [screenshots, setScreenshots] = useState<LocalScreenshot[] | null>(
    null
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    review.selectedClientId
  );
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const library = useAppSelector((state) => state.library.value);
  const hasLiveSnapshot = useRef(false);

  useEffect(() => {
    if (review.selectedClientId) setSelectedClientId(review.selectedClientId);
  }, [review.selectedClientId]);

  useEffect(() => {
    let active = true;

    const unsubscribeChanges = window.electron.onLocalScreenshotsChange(
      (nextScreenshots) => {
        hasLiveSnapshot.current = true;
        setScreenshots(nextScreenshots);
      }
    );
    const unsubscribeProgress = window.electron.onScreenshotUploadProgress(
      (progress) => {
        setScreenshots((current) =>
          current ? applyUploadProgress(current, progress) : current
        );
      }
    );

    window.electron
      .getLocalScreenshots()
      .then((initialScreenshots) => {
        if (active && !hasLiveSnapshot.current) {
          setScreenshots(initialScreenshots);
        }
      })
      .catch((error) => {
        logger.error("Failed to load screenshots for review", error);
      });

    return () => {
      active = false;
      unsubscribeChanges();
      unsubscribeProgress();
    };
  }, []);

  const reviewScreenshots = useMemo(
    () =>
      screenshots ? selectReviewScreenshots(screenshots, review.clientIds) : [],
    [screenshots, review.clientIds]
  );

  const { getDraft, updateDraft, flushDrafts } =
    useScreenshotReviewDrafts(reviewScreenshots);

  const isLoaded = screenshots !== null;
  const pendingScreenshots = reviewScreenshots.filter(
    isScreenshotAwaitingReview
  );
  const selectedScreenshot =
    reviewScreenshots.find(
      (screenshot) => screenshot.clientId === selectedClientId
    ) ??
    pendingScreenshots[0] ??
    reviewScreenshots[0] ??
    null;
  const isMultiple = reviewScreenshots.length > 1;

  useEffect(() => {
    if (isLoaded && reviewScreenshots.length === 0) closeReview();
  }, [isLoaded, reviewScreenshots.length]);

  const viewerItems = useMemo<GalleryMediaItem[]>(
    () =>
      reviewScreenshots.map((screenshot) => ({
        id: screenshot.clientId,
        type: "image",
        src: getLocalImageSource(screenshot.path),
        alt: screenshot.gameTitle,
      })),
    [reviewScreenshots]
  );

  const selectedIndex = selectedScreenshot
    ? reviewScreenshots.indexOf(selectedScreenshot)
    : -1;
  const selectedDraft = selectedScreenshot
    ? getDraft(selectedScreenshot)
    : null;
  const libraryGame = selectedScreenshot
    ? library.find(
        (game) =>
          game.shop === selectedScreenshot.shop &&
          game.objectId === selectedScreenshot.objectId
      )
    : undefined;
  const gameIconUrl = libraryGame?.customIconUrl || libraryGame?.iconUrl;
  const gameTitle = selectedScreenshot
    ? (selectedScreenshot.shop === "custom" &&
        selectedDraft?.customGameTitle.trim()) ||
      selectedScreenshot.gameTitle
    : "";

  const nextUndecidedScreenshot = [
    ...reviewScreenshots.slice(selectedIndex + 1),
    ...reviewScreenshots.slice(0, Math.max(selectedIndex, 0)),
  ].find(isScreenshotUndecided);

  const selectScreenshot = (clientId: string) => {
    flushDrafts();
    setSelectedClientId(clientId);
  };

  const goToNextScreenshot = () => {
    if (nextUndecidedScreenshot) {
      selectScreenshot(nextUndecidedScreenshot.clientId);
      return;
    }
    flushDrafts();
    closeReview();
  };

  useEffect(() => {
    if (!isViewerOpen) return;
    const closeViewerFirst = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      setIsViewerOpen(false);
    };
    window.addEventListener("keydown", closeViewerFirst, true);
    return () => window.removeEventListener("keydown", closeViewerFirst, true);
  }, [isViewerOpen]);

  return (
    <Modal
      visible
      title={
        <span className="screenshot-review-modal__heading">
          {gameIconUrl && (
            <img
              className="screenshot-review-modal__game-icon"
              src={gameIconUrl}
              alt=""
              draggable={false}
            />
          )}
          <span className="screenshot-review-modal__game-title">
            {gameTitle}
          </span>
          {isMultiple && selectedIndex !== -1 && (
            <span className="screenshot-review-modal__position">
              {t("review_position", {
                index: selectedIndex + 1,
                count: reviewScreenshots.length,
              })}
            </span>
          )}
        </span>
      }
      onClose={closeReview}
      onCloseStart={flushDrafts}
      clickOutsideToClose={!isViewerOpen}
      className="screenshot-review-modal"
    >
      <div
        className={cn("screenshot-review", {
          "screenshot-review--multiple": isMultiple,
        })}
      >
        {selectedScreenshot && (
          <ScreenshotReviewItem
            key={selectedScreenshot.clientId}
            screenshot={selectedScreenshot}
            draft={getDraft(selectedScreenshot)}
            onDraftCommit={flushDrafts}
            onDraftChange={(draft) =>
              updateDraft(selectedScreenshot.clientId, draft)
            }
            onExpand={() => setIsViewerOpen(true)}
            isDetailsOpen={isDetailsOpen}
            onToggleDetails={() => setIsDetailsOpen((current) => !current)}
            hasNext={Boolean(nextUndecidedScreenshot)}
            onNext={goToNextScreenshot}
          />
        )}

        {isMultiple && (
          <ReviewFilmstrip
            screenshots={reviewScreenshots}
            selectedClientId={selectedScreenshot?.clientId ?? null}
            label={t("review_count", { count: reviewScreenshots.length })}
            onSelect={selectScreenshot}
          />
        )}
      </div>

      {viewerItems.length > 0 && (
        <GalleryLightbox
          visible={isViewerOpen}
          fullscreen
          items={viewerItems}
          index={Math.max(selectedIndex, 0)}
          showFilmstrip={false}
          showCounter={false}
          onNavigate={(nextIndex) => {
            const nextScreenshot = reviewScreenshots[nextIndex];
            if (nextScreenshot) selectScreenshot(nextScreenshot.clientId);
          }}
          onClose={() => setIsViewerOpen(false)}
        />
      )}
    </Modal>
  );
}
