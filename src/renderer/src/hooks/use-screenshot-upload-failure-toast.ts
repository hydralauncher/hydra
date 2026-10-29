import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  createScreenshotUploadOutcomeTracker,
  getScreenshotModerationReasonKey,
  getScreenshotUploadErrorKey,
} from "@shared";
import type { LocalScreenshot } from "@types";
import { logger } from "@renderer/logger";

import { useFeature } from "./use-feature";
import { useToast } from "./use-toast";

export function useScreenshotUploadFailureToast() {
  const { t } = useTranslation("screenshots_capture");
  const { t: tModeration } = useTranslation("screenshots_moderation");
  const { showErrorToast } = useToast();
  const { isFeatureEnabled, Feature } = useFeature();
  const isScreenshotsEnabled = isFeatureEnabled(Feature.Screenshots);

  useEffect(() => {
    if (!isScreenshotsEnabled) return;
    const track = createScreenshotUploadOutcomeTracker();
    let hasSeenChange = false;

    const showProblem = (screenshot: LocalScreenshot) => {
      if (screenshot.state === "failed") {
        showErrorToast(
          t("upload_failed"),
          t(getScreenshotUploadErrorKey(screenshot.lastError))
        );
        return;
      }
      showErrorToast(
        t("upload_blocked"),
        tModeration(
          getScreenshotModerationReasonKey(screenshot.moderationReason)
        )
      );
    };

    window.electron
      .getLocalScreenshots()
      .then((screenshots) => {
        if (!hasSeenChange) track(screenshots);
      })
      .catch((error) => {
        logger.error("Failed to load local screenshots", error);
      });

    return window.electron.onLocalScreenshotsChange((screenshots) => {
      hasSeenChange = true;
      const problems = track(screenshots);
      if (document.visibilityState !== "visible") return;
      problems.forEach(showProblem);
    });
  }, [isScreenshotsEnabled, showErrorToast, t, tModeration]);
}
