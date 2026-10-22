import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ProfileScreenshot,
  ScreenshotLikeResponse,
  ScreenshotUnlikeResponse,
  ScreenshotReportValues,
  ScreenshotUpdateRequest,
  ScreenshotUpdateResponse,
} from "@types";
import {
  AuthPage,
  buildProfileScreenshotPath,
  buildUserScreenshotLikePath,
  buildUserScreenshotReportPath,
  getEditedScreenshotFields,
  getScreenshotApiErrorCode,
  type ScreenshotPatch,
} from "@shared";
import { logger } from "@renderer/logger";

import { useBigPictureToast } from "../../../../hooks";
import { getScreenshotErrorKey } from "../helpers";

const getLikePatch = (
  response: ScreenshotLikeResponse | ScreenshotUnlikeResponse
): Partial<ProfileScreenshot> =>
  typeof response.likeCount === "number"
    ? { likedByMe: response.likedByMe, likeCount: response.likeCount }
    : { likedByMe: response.likedByMe };

const SETTINGS_TOAST = { fallbackVisual: "settings" as const };

interface LightboxSocialOptions {
  screenshot: ProfileScreenshot | null;
  isSignedIn: boolean;
  onUpdate: (screenshotId: string, update: ScreenshotPatch) => void;
  onRemove: (screenshotId: string, ownerId: string) => void;
  onUnavailable: (screenshotId: string, ownerId: string) => void;
}

export function useLightboxSocialActions({
  screenshot,
  isSignedIn,
  onUpdate,
  onRemove,
  onUnavailable,
}: LightboxSocialOptions) {
  const { t } = useTranslation("big_picture");
  const { showErrorToast, showSuccessToast, showWarningToast } =
    useBigPictureToast();
  const [likingIds, setLikingIds] = useState<Set<string>>(new Set());
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [isReporting, setIsReporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  const showError = useCallback(
    (error: unknown) => {
      showErrorToast(
        t(getScreenshotErrorKey(getScreenshotApiErrorCode(error))),
        SETTINGS_TOAST
      );
    },
    [showErrorToast, t]
  );

  const toggleLike = useCallback(async () => {
    if (!screenshot) return;

    if (!isSignedIn) {
      void globalThis.window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    if (likingIds.has(screenshot.id)) return;

    const previous = {
      likeCount: screenshot.likeCount,
      likedByMe: screenshot.likedByMe,
    };
    const likedByMe = !screenshot.likedByMe;
    const path = buildUserScreenshotLikePath(
      screenshot.owner.id,
      screenshot.id
    );

    setLikingIds((current) => new Set(current).add(screenshot.id));
    onUpdate(screenshot.id, {
      likedByMe,
      likeCount: Math.max(0, screenshot.likeCount + (likedByMe ? 1 : -1)),
    });

    try {
      const response = likedByMe
        ? await globalThis.window.electron.hydraApi.put<ScreenshotLikeResponse>(
            path,
            { needsAuth: true }
          )
        : await globalThis.window.electron.hydraApi.delete<ScreenshotUnlikeResponse>(
            path,
            { needsAuth: true }
          );

      if (response) onUpdate(screenshot.id, getLikePatch(response));
    } catch (error) {
      if (getScreenshotApiErrorCode(error) === "screenshots/not-found") {
        onUnavailable(screenshot.id, screenshot.owner.id);
        return;
      }

      onUpdate(screenshot.id, previous);
      showError(error);
    } finally {
      setLikingIds((current) => {
        const next = new Set(current);
        next.delete(screenshot.id);
        return next;
      });
    }
  }, [isSignedIn, likingIds, onUnavailable, onUpdate, screenshot, showError]);

  const report = useCallback(
    async (values: ScreenshotReportValues) => {
      if (!screenshot) return false;

      setIsReporting(true);

      try {
        await globalThis.window.electron.hydraApi.post(
          buildUserScreenshotReportPath(screenshot.owner.id, screenshot.id),
          { data: values, needsAuth: true }
        );
        setReportedIds((current) => new Set(current).add(screenshot.id));
        showSuccessToast(t("screenshots_reported_toast"), SETTINGS_TOAST);
        return true;
      } catch (error) {
        const code = getScreenshotApiErrorCode(error);
        showError(error);

        if (code === "screenshots/already-reported") {
          setReportedIds((current) => new Set(current).add(screenshot.id));
          return true;
        }

        if (code === "screenshots/not-found") {
          onUnavailable(screenshot.id, screenshot.owner.id);
          return true;
        }

        return false;
      } finally {
        setIsReporting(false);
      }
    },
    [onUnavailable, screenshot, showError, showSuccessToast, t]
  );

  const save = useCallback(
    async (update: ScreenshotUpdateRequest) => {
      if (!screenshot) return false;

      setIsSaving(true);

      try {
        const updated =
          await globalThis.window.electron.hydraApi.patch<ScreenshotUpdateResponse>(
            buildProfileScreenshotPath(screenshot.id),
            { data: update, needsAuth: true }
          );
        onUpdate(
          screenshot.id,
          getEditedScreenshotFields(update, updated ?? null)
        );
        const moderation = updated?.textModeration;
        if (moderation?.title === "hidden") {
          showWarningToast(
            t("title_not_allowed", { ns: "screenshots" }),
            SETTINGS_TOAST
          );
        } else if (moderation?.description === "hidden") {
          showWarningToast(
            t("description_only_visible_to_you", { ns: "screenshots" }),
            SETTINGS_TOAST
          );
        } else {
          showSuccessToast(t("screenshots_saved"), SETTINGS_TOAST);
        }
        return true;
      } catch (error) {
        showError(error);
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [onUpdate, screenshot, showError, showSuccessToast, showWarningToast, t]
  );

  const remove = useCallback(async () => {
    if (!screenshot) return false;

    setIsDeleting(true);

    try {
      await globalThis.window.electron.hydraApi.delete(
        buildProfileScreenshotPath(screenshot.id),
        { needsAuth: true }
      );
      onRemove(screenshot.id, screenshot.owner.id);
      showSuccessToast(t("screenshots_deleted"), SETTINGS_TOAST);
      return true;
    } catch (error) {
      logger.error("Failed to delete screenshot", error);
      showError(error);
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, [onRemove, screenshot, showError, showSuccessToast, t]);

  const copyImage = useCallback(async () => {
    if (!screenshot?.imageUrl || isCopying) return;

    setIsCopying(true);

    try {
      const copied = await globalThis.window.electron.clipboard.writeImage(
        screenshot.imageUrl
      );

      if (copied) {
        showSuccessToast(t("screenshots_copied"), SETTINGS_TOAST);
      } else {
        showErrorToast(t("screenshots_copy_failed"), SETTINGS_TOAST);
      }
    } catch (error) {
      logger.error("Failed to copy screenshot", error);
      showErrorToast(t("screenshots_copy_failed"), SETTINGS_TOAST);
    } finally {
      setIsCopying(false);
    }
  }, [isCopying, screenshot, showErrorToast, showSuccessToast, t]);

  return {
    isCopying,
    copyImage,
    isLiking: Boolean(screenshot && likingIds.has(screenshot.id)),
    isReported: Boolean(screenshot && reportedIds.has(screenshot.id)),
    isReporting,
    isSaving,
    isDeleting,
    toggleLike,
    report,
    save,
    remove,
  };
}

export type LightboxSocial = ReturnType<typeof useLightboxSocialActions>;
