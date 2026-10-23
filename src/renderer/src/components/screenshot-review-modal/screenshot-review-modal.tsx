import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { CheckCircleIcon } from "@primer/octicons-react";
import type { LocalScreenshot, ScreenshotReview } from "@types";
import { Button, Modal } from "@renderer/components";
import { logger } from "@renderer/logger";

import { ScreenshotReviewItem } from "./screenshot-review-item";
import {
  applyUploadProgress,
  createReviewDraft,
  getLocalImageSource,
  getReviewTone,
  isScreenshotAwaitingReview,
  selectReviewScreenshots,
  type ScreenshotReviewDraft,
} from "./screenshot-review-state";

import "./screenshot-review-modal.scss";

const MAX_VISIBLE_THUMBNAILS = 5;
const DRAFT_SAVE_DELAY_MS = 300;

const closeReview = () => {
  window.electron.closeScreenshotReview().catch((error) => {
    logger.error("Failed to close the screenshot review", error);
  });
};

export function ScreenshotReviewModal() {
  const [review, setReview] = useState<ScreenshotReview | null>(null);

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
  const [drafts, setDrafts] = useState<Record<string, ScreenshotReviewDraft>>(
    {}
  );
  const hasLiveSnapshot = useRef(false);
  const draftsRef = useRef(drafts);
  const draftSaveTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  draftsRef.current = drafts;

  useEffect(() => {
    if (review.selectedClientId) setSelectedClientId(review.selectedClientId);
  }, [review]);

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

  useEffect(() => {
    setDrafts((current) => {
      const missing = reviewScreenshots.filter(
        (screenshot) => !current[screenshot.clientId]
      );
      if (!missing.length) return current;
      const next = { ...current };
      for (const screenshot of missing) {
        next[screenshot.clientId] = createReviewDraft(screenshot);
      }
      return next;
    });
  }, [reviewScreenshots]);

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
  const isAllDone =
    isLoaded && reviewScreenshots.length > 0 && pendingScreenshots.length === 0;

  useEffect(() => {
    if (isLoaded && reviewScreenshots.length === 0) closeReview();
  }, [isLoaded, reviewScreenshots.length]);

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

  const title = isMultiple
    ? t("review_count", { count: reviewScreenshots.length })
    : t("review_title");

  return (
    <Modal
      visible
      title={title}
      onClose={closeReview}
      onCloseStart={flushDrafts}
      noContentPadding
      className="screenshot-review-modal"
    >
      <div
        className={cn("screenshot-review", {
          "screenshot-review--multiple": isMultiple,
        })}
      >
        {isMultiple && (
          <section className="screenshot-review__toolbar">
            <div
              className={cn("screenshot-review__strip", {
                "screenshot-review__strip--overflowing":
                  reviewScreenshots.length > MAX_VISIBLE_THUMBNAILS,
              })}
              role="tablist"
              aria-label={title}
            >
              {reviewScreenshots.map((screenshot, index) => {
                const isSelected =
                  screenshot.clientId === selectedScreenshot?.clientId;
                return (
                  <button
                    key={screenshot.clientId}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    aria-current={isSelected ? "true" : undefined}
                    aria-label={t("thumbnail_label", {
                      index: index + 1,
                      count: reviewScreenshots.length,
                    })}
                    className={cn("screenshot-review__thumb", {
                      "screenshot-review__thumb--selected": isSelected,
                    })}
                    onClick={() => {
                      flushDrafts();
                      setSelectedClientId(screenshot.clientId);
                    }}
                  >
                    <img
                      src={getLocalImageSource(
                        screenshot.previewPath ?? screenshot.path
                      )}
                      alt=""
                      loading="lazy"
                      draggable={false}
                    />
                    <span
                      className={cn(
                        "screenshot-review__thumb-status",
                        `screenshot-review__thumb-status--${getReviewTone(screenshot)}`
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {isMultiple && isAllDone && (
          <output className="screenshot-review__done">
            <CheckCircleIcon size={16} />
            <span>{t("review_all_done")}</span>
            <Button theme="outline" size="small" onClick={closeReview}>
              {t("close")}
            </Button>
          </output>
        )}

        <div className="screenshot-review__content">
          {selectedScreenshot && (
            <ScreenshotReviewItem
              key={selectedScreenshot.clientId}
              screenshot={selectedScreenshot}
              draft={
                drafts[selectedScreenshot.clientId] ??
                createReviewDraft(selectedScreenshot)
              }
              onDraftCommit={flushDrafts}
              onDraftChange={(draft) =>
                updateDraft(selectedScreenshot.clientId, draft)
              }
              canClose={!isMultiple}
              onClose={closeReview}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
