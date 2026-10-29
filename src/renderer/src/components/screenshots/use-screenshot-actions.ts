import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast, useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  AuthPage,
  buildProfileScreenshotPath,
  buildUserScreenshotLikePath,
  buildUserScreenshotReportPath,
  getScreenshotApiErrorCode,
  getEditedScreenshotFields,
  getToggledScreenshotLike,
  normalizeScreenshotReportValues,
} from "@shared";
import type {
  ProfileScreenshot,
  ScreenshotReportValues,
  ScreenshotUpdateRequest,
  ScreenshotUpdateResponse,
} from "@types";

export type ScreenshotFailure = "private" | "unavailable";

interface UseScreenshotActionsOptions {
  onPatch: (screenshotId: string, patch: Partial<ProfileScreenshot>) => void;
  onRemove: (screenshot: ProfileScreenshot) => void;
  onFailure?: (screenshotId: string, failure: ScreenshotFailure) => void;
}

const forgetDeletedScreenshot = (screenshotId: string) => {
  window.electron
    .forgetPublishedScreenshots([screenshotId])
    .catch((error) =>
      logger.error("Failed to forget the deleted screenshot", error)
    );
};

function usePendingIds() {
  const pendingRef = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const start = useCallback((id: string) => {
    if (pendingRef.current.has(id)) return false;
    pendingRef.current.add(id);
    setPendingIds(new Set(pendingRef.current));
    return true;
  }, []);

  const finish = useCallback((id: string) => {
    pendingRef.current.delete(id);
    setPendingIds(new Set(pendingRef.current));
  }, []);

  return { pendingIds, start, finish };
}

export function useScreenshotActions({
  onPatch,
  onRemove,
  onFailure,
}: UseScreenshotActionsOptions) {
  const { t } = useTranslation("screenshots");
  const { userDetails } = useUserDetails();
  const { showErrorToast, showSuccessToast, showWarningToast } = useToast();
  const {
    pendingIds: likingIds,
    start: startLiking,
    finish: finishLiking,
  } = usePendingIds();
  const {
    pendingIds: updatingIds,
    start: startUpdating,
    finish: finishUpdating,
  } = usePendingIds();
  const {
    pendingIds: deletingIds,
    start: startDeleting,
    finish: finishDeleting,
  } = usePendingIds();
  const {
    pendingIds: reportingIds,
    start: startReporting,
    finish: finishReporting,
  } = usePendingIds();
  const {
    pendingIds: copyingIds,
    start: startCopying,
    finish: finishCopying,
  } = usePendingIds();
  const [reportedIds, setReportedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const markReported = useCallback((screenshotId: string) => {
    setReportedIds((current) => new Set(current).add(screenshotId));
  }, []);

  const handleAccessError = useCallback(
    (screenshot: ProfileScreenshot, error: unknown) => {
      const code = getScreenshotApiErrorCode(error);
      const screenshotId = screenshot.id;

      if (code === "screenshots/not-found") {
        onFailure?.(screenshotId, "unavailable");
        onRemove(screenshot);
        showErrorToast(t("screenshot_unavailable"));
        return true;
      }

      if (code === "screenshots/private") {
        onFailure?.(screenshotId, "private");
        showErrorToast(t("screenshot_private"));
        return true;
      }

      return false;
    },
    [onFailure, onRemove, showErrorToast, t]
  );

  const toggleLike = useCallback(
    async (screenshot: ProfileScreenshot) => {
      if (!userDetails) {
        void window.electron.openAuthWindow(AuthPage.SignIn);
        return;
      }

      if (!startLiking(screenshot.id)) return;

      const previous = {
        likeCount: screenshot.likeCount,
        likedByMe: screenshot.likedByMe,
      };
      const optimistic = getToggledScreenshotLike(screenshot);
      const path = buildUserScreenshotLikePath(
        screenshot.owner.id,
        screenshot.id
      );
      onPatch(screenshot.id, optimistic);

      try {
        if (optimistic.likedByMe) {
          await window.electron.hydraApi.put(path, { needsAuth: true });
        } else {
          await window.electron.hydraApi.delete(path, { needsAuth: true });
        }
      } catch (error) {
        onPatch(screenshot.id, previous);
        logger.error("Failed to update screenshot like", error);
        if (!handleAccessError(screenshot, error)) {
          showErrorToast(t("like_failed"));
        }
      } finally {
        finishLiking(screenshot.id);
      }
    },
    [
      finishLiking,
      handleAccessError,
      onPatch,
      showErrorToast,
      startLiking,
      t,
      userDetails,
    ]
  );

  const persistScreenshotUpdate = useCallback(
    async (screenshot: ProfileScreenshot, update: ScreenshotUpdateRequest) => {
      try {
        const response =
          await window.electron.hydraApi.patch<ScreenshotUpdateResponse | null>(
            buildProfileScreenshotPath(screenshot.id),
            { data: update, needsAuth: true }
          );

        onPatch(screenshot.id, getEditedScreenshotFields(update, response));
        const moderation = response?.textModeration;
        if (moderation?.title === "hidden") {
          showWarningToast(t("title_not_allowed"));
        } else if (moderation?.description === "hidden") {
          showWarningToast(t("description_only_visible_to_you"));
        } else {
          showSuccessToast(t("changes_saved"));
        }
      } catch (error) {
        logger.error("Failed to update screenshot", error);
        onPatch(screenshot.id, getEditedScreenshotFields(update, screenshot));
        const code = getScreenshotApiErrorCode(error);
        if (code === "screenshots/text-change-rate-limit-unavailable") {
          showErrorToast(t("text_changes_temporarily_unavailable"));
        } else if (code === "screenshots/moderation-in-progress") {
          showErrorToast(t("moderation_in_progress"));
        } else if (!handleAccessError(screenshot, error)) {
          showErrorToast(t("update_failed"));
        }
      } finally {
        finishUpdating(screenshot.id);
      }
    },
    [
      finishUpdating,
      handleAccessError,
      onPatch,
      showErrorToast,
      showSuccessToast,
      showWarningToast,
      t,
    ]
  );

  const updateScreenshot = useCallback(
    (screenshot: ProfileScreenshot, update: ScreenshotUpdateRequest) => {
      if (!startUpdating(screenshot.id)) return Promise.resolve(false);

      onPatch(screenshot.id, getEditedScreenshotFields(update, null));
      void persistScreenshotUpdate(screenshot, update);
      return Promise.resolve(true);
    },
    [onPatch, persistScreenshotUpdate, startUpdating]
  );

  const deleteScreenshot = useCallback(
    async (screenshot: ProfileScreenshot) => {
      if (!startDeleting(screenshot.id)) return false;

      try {
        await window.electron.hydraApi.delete(
          buildProfileScreenshotPath(screenshot.id),
          { needsAuth: true }
        );
        onRemove(screenshot);
        forgetDeletedScreenshot(screenshot.id);
        showSuccessToast(t("screenshot_deleted"));
        return true;
      } catch (error) {
        logger.error("Failed to delete screenshot", error);
        if (getScreenshotApiErrorCode(error) === "screenshots/not-found") {
          onRemove(screenshot);
          forgetDeletedScreenshot(screenshot.id);
          return true;
        }
        showErrorToast(t("delete_failed"));
        return false;
      } finally {
        finishDeleting(screenshot.id);
      }
    },
    [
      finishDeleting,
      onRemove,
      showErrorToast,
      showSuccessToast,
      startDeleting,
      t,
    ]
  );

  const reportScreenshot = useCallback(
    async (screenshot: ProfileScreenshot, values: ScreenshotReportValues) => {
      if (!userDetails) {
        void window.electron.openAuthWindow(AuthPage.SignIn);
        return false;
      }

      if (!startReporting(screenshot.id)) return false;

      try {
        await window.electron.hydraApi.post(
          buildUserScreenshotReportPath(screenshot.owner.id, screenshot.id),
          { data: normalizeScreenshotReportValues(values), needsAuth: true }
        );
        markReported(screenshot.id);
        showSuccessToast(t("screenshot_reported"));
        return true;
      } catch (error) {
        logger.error("Failed to report screenshot", error);
        const code = getScreenshotApiErrorCode(error);

        if (code === "screenshots/already-reported") {
          markReported(screenshot.id);
          showSuccessToast(t("screenshot_already_reported"));
          return true;
        }

        if (code === "screenshots/report-rate-limited") {
          showErrorToast(t("report_rate_limited"));
          return false;
        }

        if (!handleAccessError(screenshot, error)) {
          showErrorToast(t("report_failed"));
        }
        return code === "screenshots/not-found";
      } finally {
        finishReporting(screenshot.id);
      }
    },
    [
      handleAccessError,
      finishReporting,
      markReported,
      showErrorToast,
      showSuccessToast,
      startReporting,
      t,
      userDetails,
    ]
  );

  const copyImage = useCallback(
    async (screenshot: ProfileScreenshot) => {
      if (!screenshot.imageUrl || !startCopying(screenshot.id)) return;

      try {
        const copied = await window.electron.clipboard.writeImage(
          screenshot.owner.id,
          screenshot.id
        );
        if (copied) {
          showSuccessToast(t("image_copied"));
        } else {
          showErrorToast(t("copy_image_failed"));
        }
      } catch (error) {
        logger.error("Failed to copy screenshot image", error);
        showErrorToast(t("copy_image_failed"));
      } finally {
        finishCopying(screenshot.id);
      }
    },
    [finishCopying, showErrorToast, showSuccessToast, startCopying, t]
  );

  return {
    likingIds,
    updatingIds,
    deletingIds,
    reportingIds,
    copyingIds,
    reportedIds,
    toggleLike,
    updateScreenshot,
    deleteScreenshot,
    reportScreenshot,
    copyImage,
  };
}
