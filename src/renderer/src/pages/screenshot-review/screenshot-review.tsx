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
  isScreenshotReviewDone,
  parseClientIds,
  selectReviewScreenshots,
} from "./screenshot-review-state";

import "./screenshot-review.scss";

const closeWindow = () => window.close();

export function ScreenshotReview() {
  const { t } = useTranslation("screenshots_capture");
  const [searchParams] = useSearchParams();
  const isGrid = searchParams.get("grid") === "1";

  const [clientIds, setClientIds] = useState(() =>
    parseClientIds(searchParams.get("clientIds"))
  );
  const [screenshots, setScreenshots] = useState<LocalScreenshot[] | null>(
    null
  );
  const [hiddenClientIds, setHiddenClientIds] = useState<string[]>([]);
  const hasLiveSnapshot = useRef(false);

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

  useEffect(() => {
    if (!isGrid) return;
    return window.electron.onScreenshotReviewItemsChanged(setClientIds);
  }, [isGrid]);

  const reviewScreenshots = useMemo(
    () =>
      screenshots
        ? selectReviewScreenshots(screenshots, clientIds, hiddenClientIds)
        : [],
    [screenshots, clientIds, hiddenClientIds]
  );

  const singleScreenshot = isGrid ? null : (reviewScreenshots[0] ?? null);
  const isLoaded = screenshots !== null;

  useEffect(() => {
    if (!isGrid && isLoaded && !singleScreenshot) closeWindow();
  }, [isGrid, isLoaded, singleScreenshot]);

  const hideScreenshot = useCallback((clientId: string) => {
    setHiddenClientIds((current) =>
      current.includes(clientId) ? current : [...current, clientId]
    );
  }, []);

  const isAllDone = isLoaded && reviewScreenshots.every(isScreenshotReviewDone);

  const title = isGrid
    ? t("grid_title", {
        count: isLoaded ? reviewScreenshots.length : clientIds.length,
      })
    : t("review_title");

  const renderGrid = () => {
    if (!isLoaded) return null;

    return (
      <>
        {isAllDone && (
          <div className="screenshot-review__done" role="status">
            <CheckCircleIcon size={20} />
            <p>{t("review_all_done")}</p>
            <Button theme="outline" size="small" onClick={closeWindow}>
              {t("close")}
            </Button>
          </div>
        )}

        {reviewScreenshots.length > 0 && (
          <div className="screenshot-review__grid">
            {reviewScreenshots.map((screenshot) => (
              <ScreenshotReviewItem
                key={screenshot.clientId}
                screenshot={screenshot}
                variant="grid"
                onRemoved={hideScreenshot}
              />
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div
      className={cn("screenshot-review", {
        "screenshot-review--grid": isGrid,
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

      <main className="screenshot-review__content">
        {isGrid
          ? renderGrid()
          : singleScreenshot && (
              <ScreenshotReviewItem
                key={singleScreenshot.clientId}
                screenshot={singleScreenshot}
                variant="single"
              />
            )}
      </main>
    </div>
  );
}
