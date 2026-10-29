import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { createScreenshotUploadOutcomeTracker } from "@shared";
import { logger } from "@renderer/logger";

import { IS_DESKTOP } from "../constants";
import { Feature, useBigPictureToast, useFeature } from "../hooks";
import { getLocalScreenshotStatusDetail } from "./pages/screenshots";

export function ScreenshotUploadFailureToast() {
  const { t } = useTranslation("big_picture");
  const { showErrorToast } = useBigPictureToast();
  const { isFeatureEnabled } = useFeature();
  const isScreenshotsEnabled = isFeatureEnabled(Feature.Screenshots);

  useEffect(() => {
    if (!IS_DESKTOP || !isScreenshotsEnabled) return;
    const track = createScreenshotUploadOutcomeTracker();
    let hasSeenChange = false;

    globalThis.window.electron
      .getLocalScreenshots()
      .then((screenshots) => {
        if (!hasSeenChange) track(screenshots);
      })
      .catch((error: unknown) => {
        logger.error("Failed to load local screenshots", error);
      });

    return globalThis.window.electron.onLocalScreenshotsChange(
      (screenshots) => {
        hasSeenChange = true;
        const problems = track(screenshots);
        if (document.visibilityState !== "visible") return;

        for (const screenshot of problems) {
          showErrorToast(
            t(
              screenshot.state === "failed"
                ? "screenshots_review_upload_failed"
                : "screenshots_review_upload_blocked"
            ),
            {
              message:
                getLocalScreenshotStatusDetail(screenshot, t) ?? undefined,
              fallbackVisual: "settings",
            }
          );
        }
      }
    );
  }, [isScreenshotsEnabled, showErrorToast, t]);

  return null;
}
