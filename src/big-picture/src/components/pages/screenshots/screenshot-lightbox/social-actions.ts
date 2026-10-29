import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ProfileScreenshot,
  ScreenshotLikeResponse,
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
import { getLikePatch, getScreenshotErrorKey } from "../helpers";

const SETTINGS_TOAST = { fallbackVisual: "settings" as const };

const getFieldVersionKey = (screenshotId: string, field: string) =>
  `${screenshotId}:${field}`;

const getUpdatedFields = (update: ScreenshotUpdateRequest) =>
  Object.entries(update)
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field);

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
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const fieldVersionsRef = useRef(new Map<string, number>());

  const claimFieldVersions = useCallback(
    (screenshotId: string, update: ScreenshotUpdateRequest) => {
      const claimed = new Map<string, number>();
      for (const field of getUpdatedFields(update)) {
        const key = getFieldVersionKey(screenshotId, field);
        const version = (fieldVersionsRef.current.get(key) ?? 0) + 1;
        fieldVersionsRef.current.set(key, version);
        claimed.set(field, version);
      }
      return claimed;
    },
    []
  );

  const pickLatestFields = useCallback(
    (
      screenshotId: string,
      update: ScreenshotUpdateRequest,
      claimed: Map<string, number>
    ): ScreenshotUpdateRequest | null => {
      const latestEntries = Object.entries(update).filter(
        ([field]) =>
          claimed.has(field) &&
          fieldVersionsRef.current.get(
            getFieldVersionKey(screenshotId, field)
          ) === claimed.get(field)
      );
      if (latestEntries.length === 0) return null;

      return Object.fromEntries(latestEntries) as ScreenshotUpdateRequest;
    },
    []
  );

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
        : await globalThis.window.electron.hydraApi.delete<ScreenshotLikeResponse>(
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

  const persistUpdate = useCallback(
    async (
      target: ProfileScreenshot,
      update: ScreenshotUpdateRequest,
      claimed: Map<string, number>
    ) => {
      setSavingIds((current) => new Set(current).add(target.id));

      try {
        const updated =
          await globalThis.window.electron.hydraApi.patch<ScreenshotUpdateResponse>(
            buildProfileScreenshotPath(target.id),
            { data: update, needsAuth: true }
          );
        const latestUpdate = pickLatestFields(target.id, update, claimed);
        if (latestUpdate) {
          onUpdate(
            target.id,
            getEditedScreenshotFields(latestUpdate, updated ?? null)
          );
        }
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
      } catch (error) {
        const latestUpdate = pickLatestFields(target.id, update, claimed);
        if (latestUpdate) {
          onUpdate(target.id, getEditedScreenshotFields(latestUpdate, target));
        }
        showError(error);
      } finally {
        setSavingIds((current) => {
          const next = new Set(current);
          next.delete(target.id);
          return next;
        });
      }
    },
    [
      onUpdate,
      pickLatestFields,
      showError,
      showSuccessToast,
      showWarningToast,
      t,
    ]
  );

  const save = useCallback(
    async (update: ScreenshotUpdateRequest) => {
      if (!screenshot) return false;

      const claimed = claimFieldVersions(screenshot.id, update);
      onUpdate(screenshot.id, getEditedScreenshotFields(update, null));
      void persistUpdate(screenshot, update, claimed);
      return true;
    },
    [claimFieldVersions, onUpdate, persistUpdate, screenshot]
  );

  const remove = useCallback(async (): Promise<(() => void) | null> => {
    if (!screenshot) return null;

    const screenshotId = screenshot.id;
    const ownerId = screenshot.owner.id;
    setIsDeleting(true);

    try {
      await globalThis.window.electron.hydraApi.delete(
        buildProfileScreenshotPath(screenshotId),
        { needsAuth: true }
      );
      showSuccessToast(t("screenshots_deleted"), SETTINGS_TOAST);
      return () => onRemove(screenshotId, ownerId);
    } catch (error) {
      logger.error("Failed to delete screenshot", error);
      showError(error);
      return null;
    } finally {
      setIsDeleting(false);
    }
  }, [onRemove, screenshot, showError, showSuccessToast, t]);

  return {
    isLiking: Boolean(screenshot && likingIds.has(screenshot.id)),
    isReported: Boolean(screenshot && reportedIds.has(screenshot.id)),
    isReporting,
    isSaving: Boolean(screenshot && savingIds.has(screenshot.id)),
    isDeleting,
    toggleLike,
    report,
    save,
    remove,
  };
}

export type LightboxSocial = ReturnType<typeof useLightboxSocialActions>;
