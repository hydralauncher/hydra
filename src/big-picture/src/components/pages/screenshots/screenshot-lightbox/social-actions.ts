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
import {
  claimScreenshotLike,
  releaseScreenshotLike,
  useScreenshotLikesInFlight,
} from "../screenshot-likes-in-flight";

const SETTINGS_TOAST = { fallbackVisual: "settings" as const };

const getFieldVersionKey = (screenshotId: string, field: string) =>
  `${screenshotId}:${field}`;

const getUpdatedFields = (update: ScreenshotUpdateRequest) =>
  Object.entries(update)
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field);

interface ConfirmedField {
  patch: Partial<ProfileScreenshot>;
  version: number;
  inFlight: number;
  isShown: boolean;
}

const forgetDeletedScreenshot = (screenshotId: string) => {
  globalThis.window.electron
    .forgetPublishedScreenshots([screenshotId])
    .catch((error: unknown) =>
      logger.error("Failed to forget the deleted screenshot", error)
    );
};

const pickField = (
  update: ScreenshotUpdateRequest,
  field: string
): ScreenshotUpdateRequest => ({
  [field]: update[field as keyof ScreenshotUpdateRequest],
});

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
  const likingIds = useScreenshotLikesInFlight((state) => state.ids);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [isReporting, setIsReporting] = useState(false);
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const fieldVersionsRef = useRef(new Map<string, number>());
  const confirmedFieldsRef = useRef(new Map<string, ConfirmedField>());
  const savesInFlightRef = useRef(new Map<string, number>());

  const claimFieldVersions = useCallback(
    (target: ProfileScreenshot, update: ScreenshotUpdateRequest) => {
      const claimed = new Map<string, number>();
      for (const field of getUpdatedFields(update)) {
        const key = getFieldVersionKey(target.id, field);
        const version = (fieldVersionsRef.current.get(key) ?? 0) + 1;
        fieldVersionsRef.current.set(key, version);
        claimed.set(field, version);

        const confirmed = confirmedFieldsRef.current.get(key) ?? {
          patch: getEditedScreenshotFields(pickField(update, field), target),
          version: 0,
          inFlight: 0,
          isShown: true,
        };
        confirmed.inFlight += 1;
        confirmed.isShown = false;
        confirmedFieldsRef.current.set(key, confirmed);
      }
      return claimed;
    },
    []
  );

  const settleField = useCallback(
    (
      screenshotId: string,
      field: string,
      version: number,
      confirmedPatch: Partial<ProfileScreenshot> | null
    ) => {
      const key = getFieldVersionKey(screenshotId, field);
      const confirmed = confirmedFieldsRef.current.get(key);
      if (!confirmed) return;

      const isLatest = fieldVersionsRef.current.get(key) === version;
      if (confirmedPatch && version > confirmed.version) {
        confirmed.patch = confirmedPatch;
        confirmed.version = version;
        confirmed.isShown = false;
      }
      if (isLatest && !confirmed.isShown) {
        onUpdate(screenshotId, confirmed.patch);
        confirmed.isShown = true;
      }

      confirmed.inFlight -= 1;
      if (confirmed.inFlight > 0) return;

      confirmedFieldsRef.current.delete(key);
      if (!confirmed.isShown) onUpdate(screenshotId, confirmed.patch);
    },
    [onUpdate]
  );

  const startSaving = useCallback((screenshotId: string) => {
    const count = savesInFlightRef.current.get(screenshotId) ?? 0;
    savesInFlightRef.current.set(screenshotId, count + 1);
    setSavingIds((current) => new Set(current).add(screenshotId));
  }, []);

  const finishSaving = useCallback((screenshotId: string) => {
    const count = (savesInFlightRef.current.get(screenshotId) ?? 1) - 1;
    if (count > 0) {
      savesInFlightRef.current.set(screenshotId, count);
      return;
    }

    savesInFlightRef.current.delete(screenshotId);
    setSavingIds((current) => {
      const next = new Set(current);
      next.delete(screenshotId);
      return next;
    });
  }, []);

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

    if (!claimScreenshotLike(screenshot.id)) return;

    const previous = {
      likeCount: screenshot.likeCount,
      likedByMe: screenshot.likedByMe,
    };
    const likedByMe = !screenshot.likedByMe;
    const path = buildUserScreenshotLikePath(
      screenshot.owner.id,
      screenshot.id
    );

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
      releaseScreenshotLike(screenshot.id);
    }
  }, [isSignedIn, onUnavailable, onUpdate, screenshot, showError]);

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

        if (code === "screenshots/already-reported") {
          setReportedIds((current) => new Set(current).add(screenshot.id));
          showSuccessToast(
            t("screenshots_error_already_reported"),
            SETTINGS_TOAST
          );
          return true;
        }

        showError(error);

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
      startSaving(target.id);

      try {
        const updated =
          await globalThis.window.electron.hydraApi.patch<ScreenshotUpdateResponse>(
            buildProfileScreenshotPath(target.id),
            { data: update, needsAuth: true }
          );
        for (const [field, version] of claimed) {
          settleField(
            target.id,
            field,
            version,
            getEditedScreenshotFields(pickField(update, field), updated ?? null)
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
        for (const [field, version] of claimed) {
          settleField(target.id, field, version, null);
        }
        showError(error);
      } finally {
        finishSaving(target.id);
      }
    },
    [
      finishSaving,
      settleField,
      showError,
      showSuccessToast,
      showWarningToast,
      startSaving,
      t,
    ]
  );

  const save = useCallback(
    async (update: ScreenshotUpdateRequest) => {
      if (!screenshot) return false;

      const claimed = claimFieldVersions(screenshot, update);
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
      forgetDeletedScreenshot(screenshotId);
      showSuccessToast(t("screenshots_deleted"), SETTINGS_TOAST);
      return () => onRemove(screenshotId, ownerId);
    } catch (error) {
      logger.error("Failed to delete screenshot", error);
      if (getScreenshotApiErrorCode(error) === "screenshots/not-found") {
        forgetDeletedScreenshot(screenshotId);
        return () => onRemove(screenshotId, ownerId);
      }
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
