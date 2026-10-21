import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { CheckCircleIcon, XIcon } from "@primer/octicons-react";
import type { LocalScreenshot } from "@types";
import { Button } from "@renderer/components";
import { logger } from "@renderer/logger";

import { ScreenshotReviewItem } from "./screenshot-review-item";
import {
  applyUploadProgress,
  createReviewDraft,
  getLocalImageSource,
  getReviewTone,
  isScreenshotAwaitingReview,
  parseClientIds,
  selectReviewScreenshots,
  toUploadOptions,
  type ScreenshotReviewDraft,
} from "./screenshot-review-state";

import "./screenshot-review.scss";

const MAX_VISIBLE_THUMBNAILS = 5;
const DRAFT_SAVE_DELAY_MS = 300;

const closeWindow = () => window.close();

export function ScreenshotReview() {
  const { t } = useTranslation("screenshots_capture");
  const [searchParams] = useSearchParams();

  const [clientIds, setClientIds] = useState(() =>
    parseClientIds(searchParams.get("clientIds"))
  );
  const [screenshots, setScreenshots] = useState<LocalScreenshot[] | null>(
    null
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ScreenshotReviewDraft>>(
    {}
  );
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const hasLiveSnapshot = useRef(false);
  const clientIdsRef = useRef(clientIds);
  const draftsRef = useRef(drafts);
  const draftSaveTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  clientIdsRef.current = clientIds;
  draftsRef.current = drafts;

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
    const unsubscribeItems =
      window.electron.onScreenshotReviewItemsChanged(setClientIds);

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

    window.electron
      .getScreenshotReviewItems()
      .then((currentClientIds) => {
        if (active && currentClientIds) setClientIds(currentClientIds);
      })
      .catch((error) => {
        logger.error("Failed to load the screenshot review items", error);
      });

    return () => {
      active = false;
      unsubscribeChanges();
      unsubscribeProgress();
      unsubscribeItems();
    };
  }, []);

  const reviewScreenshots = useMemo(
    () => (screenshots ? selectReviewScreenshots(screenshots, clientIds) : []),
    [screenshots, clientIds]
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
    if (isLoaded && reviewScreenshots.length === 0) closeWindow();
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

  const runBulk = async (
    action: (
      screenshot: LocalScreenshot,
      draft: ScreenshotReviewDraft
    ) => Promise<unknown>
  ) => {
    setIsBulkBusy(true);
    try {
      const latest = await window.electron.getLocalScreenshots();
      const targets = selectReviewScreenshots(
        latest,
        clientIdsRef.current
      ).filter(isScreenshotAwaitingReview);
      const results = await Promise.allSettled(
        targets.map((screenshot) =>
          action(
            screenshot,
            draftsRef.current[screenshot.clientId] ??
              createReviewDraft(screenshot)
          )
        )
      );
      for (const result of results) {
        if (result.status === "rejected") {
          logger.error(
            "Failed to apply the bulk screenshot action",
            result.reason
          );
        }
      }
    } catch (error) {
      logger.error("Failed to load screenshots for the bulk action", error);
    } finally {
      setIsBulkBusy(false);
    }
  };

  const handleUploadAll = () =>
    runBulk((screenshot, draft) =>
      window.electron.uploadLocalScreenshot(
        screenshot.clientId,
        toUploadOptions(screenshot, draft)
      )
    );

  const handleKeepAll = () =>
    runBulk((screenshot) =>
      window.electron.skipLocalScreenshot(screenshot.clientId)
    );

  const title = isMultiple
    ? t("review_count", { count: reviewScreenshots.length })
    : t("review_title");

  return (
    <div
      className={cn("screenshot-review", {
        "screenshot-review--multiple": isMultiple,
      })}
    >
      <header className="screenshot-review__title-bar">
        <h4>{title}</h4>
        <div className="screenshot-review__window-controls">
          <button
            type="button"
            className="screenshot-review__window-control"
            onClick={closeWindow}
            title={t("close")}
            aria-label={t("close")}
          >
            <XIcon size={16} />
          </button>
        </div>
      </header>

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
                  disabled={isBulkBusy}
                  onClick={() => {
                    flushDrafts();
                    setSelectedClientId(screenshot.clientId);
                  }}
                >
                  <img
                    src={getLocalImageSource(screenshot.path)}
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
          <Button theme="outline" size="small" onClick={closeWindow}>
            {t("close")}
          </Button>
        </output>
      )}

      <main className="screenshot-review__content">
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
            isLocked={isBulkBusy}
            pendingCount={pendingScreenshots.length}
            onUploadAll={handleUploadAll}
            onKeepAll={handleKeepAll}
          />
        )}
      </main>
    </div>
  );
}
