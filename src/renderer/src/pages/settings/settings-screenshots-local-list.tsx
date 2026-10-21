import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { Button, ConfirmationModal, ProgressBar } from "@renderer/components";
import { useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  getScreenshotModerationReasonKey,
  getScreenshotUploadErrorKey,
  isScreenshotUploadRetryable,
} from "@shared";
import type { LocalScreenshot, ScreenshotUploadProgress } from "@types";

const SCREENSHOTS_PAGE_SIZE = 24;

type StatusTone = "neutral" | "progress" | "success" | "warning" | "danger";

interface ScreenshotStatus {
  label: string;
  tone: StatusTone;
  detail?: string;
}

export const mergeScreenshotUploadProgress = (
  screenshots: LocalScreenshot[],
  progress: ScreenshotUploadProgress
) =>
  screenshots.map((screenshot) =>
    screenshot.clientId === progress.clientId
      ? {
          ...screenshot,
          state: progress.state,
          uploadProgress: progress.progress,
        }
      : screenshot
  );

const toVisibleScreenshots = (screenshots: LocalScreenshot[]) =>
  screenshots
    .filter((screenshot) => screenshot.state !== "deleted")
    .toSorted((a, b) => b.capturedAt - a.capturedAt);

const toLocalImageSrc = (path: string) => `local:${path.replaceAll("\\", "/")}`;

const getScreenshotTitle = (screenshot: LocalScreenshot) =>
  (screenshot.shop === "custom" && screenshot.customGameTitle) ||
  screenshot.gameTitle;

const roundProgress = (progress: number | null) =>
  Math.max(0, Math.min(100, Math.round((progress ?? 0) * 100)));

export function SettingsScreenshotsLocalList() {
  const { t } = useTranslation("settings");
  const { t: tCapture } = useTranslation("screenshots_capture");
  const { t: tModeration } = useTranslation("screenshots_moderation");
  const { userDetails } = useUserDetails();

  const [screenshots, setScreenshots] = useState<LocalScreenshot[]>([]);
  const [visibleCount, setVisibleCount] = useState(SCREENSHOTS_PAGE_SIZE);
  const [busyClientIds, setBusyClientIds] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<LocalScreenshot | null>(
    null
  );

  useEffect(() => {
    let isMounted = true;

    window.electron
      .getLocalScreenshots()
      .then((result) => {
        if (isMounted) setScreenshots(result);
      })
      .catch((error) => logger.error("Failed to load screenshots", error));

    const unsubscribeChange = window.electron.onLocalScreenshotsChange(
      (result) => setScreenshots(result)
    );
    const unsubscribeProgress = window.electron.onScreenshotUploadProgress(
      (progress) =>
        setScreenshots((previous) =>
          mergeScreenshotUploadProgress(previous, progress)
        )
    );

    return () => {
      isMounted = false;
      unsubscribeChange();
      unsubscribeProgress();
    };
  }, []);

  const visibleScreenshots = useMemo(
    () => toVisibleScreenshots(screenshots),
    [screenshots]
  );

  const setBusy = (clientId: string, isBusy: boolean) =>
    setBusyClientIds((previous) =>
      isBusy
        ? [...previous, clientId]
        : previous.filter((busyId) => busyId !== clientId)
    );

  const handleUpload = async (screenshot: LocalScreenshot) => {
    setBusy(screenshot.clientId, true);

    try {
      await window.electron.openScreenshotReview(screenshot.clientId);
    } catch (error) {
      logger.error("Failed to open the screenshot review window", error);
    } finally {
      setBusy(screenshot.clientId, false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    const { clientId } = pendingDelete;
    setPendingDelete(null);
    setBusy(clientId, true);

    try {
      await window.electron.deleteLocalScreenshot(clientId);
      setScreenshots((previous) =>
        previous.filter((item) => item.clientId !== clientId)
      );
    } catch (error) {
      logger.error("Failed to delete screenshot", error);
    } finally {
      setBusy(clientId, false);
    }
  };

  const getStatus = useCallback(
    (screenshot: LocalScreenshot): ScreenshotStatus => {
      switch (screenshot.state) {
        case "reviewing":
          return { label: t("screenshots_status_reviewing"), tone: "neutral" };
        case "queued":
          return { label: t("screenshots_status_queued"), tone: "progress" };
        case "uploading":
          return {
            label: t("screenshots_status_uploading", {
              progress: roundProgress(screenshot.uploadProgress),
            }),
            tone: "progress",
          };
        case "failed":
          return {
            label: t("screenshots_status_failed"),
            tone: "danger",
            detail: tCapture(getScreenshotUploadErrorKey(screenshot.lastError)),
          };
        case "uploaded":
          if (screenshot.moderationStatus === "APPROVED") {
            return { label: t("screenshots_status_uploaded"), tone: "success" };
          }
          if (screenshot.moderationStatus === "BLOCKED") {
            return {
              label: t("screenshots_status_blocked"),
              tone: "danger",
              detail: tModeration(
                getScreenshotModerationReasonKey(screenshot.moderationReason)
              ),
            };
          }
          return { label: t("screenshots_status_pending"), tone: "warning" };
        default:
          return { label: t("screenshots_status_local"), tone: "neutral" };
      }
    },
    [t, tCapture, tModeration]
  );

  const getUploadBlocker = (screenshot: LocalScreenshot) => {
    if (!userDetails) return t("screenshots_sign_in_to_upload");
    if (screenshot.ownerId !== null && screenshot.ownerId !== userDetails.id) {
      return t("screenshots_owned_by_other_account");
    }
    return null;
  };

  const hasUploadableState = visibleScreenshots.some((screenshot) =>
    ["local", "reviewing", "failed"].includes(screenshot.state)
  );

  return (
    <div className="settings-context-panel__group">
      <div className="settings-screenshots__group-header">
        <h3>{t("screenshots_local_group")}</h3>
        <span className="settings-screenshots__count">
          {t("screenshots_local_count", { count: visibleScreenshots.length })}
        </span>
      </div>

      {!userDetails && hasUploadableState && (
        <small className="settings-screenshots__hint">
          {t("screenshots_sign_in_to_upload")}
        </small>
      )}

      {visibleScreenshots.length === 0 ? (
        <p className="settings-screenshots__empty">
          {t("screenshots_local_empty")}
        </p>
      ) : (
        <ul className="settings-screenshots__grid">
          {visibleScreenshots.slice(0, visibleCount).map((screenshot) => {
            const status = getStatus(screenshot);
            const title = getScreenshotTitle(screenshot);
            const capturedAt = new Date(screenshot.capturedAt).toLocaleString();
            const isBusy = busyClientIds.includes(screenshot.clientId);
            const canOfferUpload =
              screenshot.state === "local" || screenshot.state === "reviewing";
            const canRetry =
              screenshot.state === "failed" &&
              isScreenshotUploadRetryable(screenshot.lastError);
            const uploadBlocker = getUploadBlocker(screenshot);
            const showOwnerHint =
              (canOfferUpload || canRetry) &&
              Boolean(userDetails) &&
              uploadBlocker !== null;

            return (
              <li
                key={screenshot.clientId}
                className="settings-screenshots__card"
              >
                <div className="settings-screenshots__thumbnail">
                  <img
                    src={toLocalImageSrc(screenshot.path)}
                    alt={tCapture("screenshot_alt", {
                      game: title,
                      date: capturedAt,
                    })}
                    loading="lazy"
                  />
                </div>

                <div className="settings-screenshots__card-body">
                  <span
                    className="settings-screenshots__card-title"
                    title={title}
                  >
                    {title}
                  </span>
                  <span className="settings-screenshots__card-date">
                    {capturedAt}
                  </span>

                  <span
                    className={cn(
                      "settings-screenshots__status",
                      `settings-screenshots__status--${status.tone}`
                    )}
                  >
                    {status.label}
                  </span>

                  {status.detail && (
                    <small className="settings-screenshots__hint">
                      {status.detail}
                    </small>
                  )}

                  {screenshot.state === "uploading" && (
                    <ProgressBar
                      now={roundProgress(screenshot.uploadProgress)}
                      max={100}
                      label={status.label}
                      completed={false}
                      trackClassName="settings-screenshots__progress-track"
                      barClassName="settings-screenshots__progress-bar"
                    />
                  )}

                  {showOwnerHint && (
                    <small className="settings-screenshots__hint">
                      {uploadBlocker}
                    </small>
                  )}

                  <div className="settings-screenshots__card-actions">
                    {(canOfferUpload || canRetry) && (
                      <Button
                        theme="outline"
                        size="small"
                        disabled={isBusy || uploadBlocker !== null}
                        tooltip={uploadBlocker ?? undefined}
                        onClick={() => handleUpload(screenshot)}
                      >
                        {canRetry
                          ? t("screenshots_retry")
                          : t("screenshots_upload")}
                      </Button>
                    )}

                    <Button
                      theme="outline"
                      size="small"
                      disabled={isBusy}
                      onClick={() => setPendingDelete(screenshot)}
                    >
                      {t("screenshots_delete")}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {visibleScreenshots.length > visibleCount && (
        <Button
          className="settings-screenshots__show-more"
          theme="outline"
          onClick={() =>
            setVisibleCount((previous) => previous + SCREENSHOTS_PAGE_SIZE)
          }
        >
          {t("screenshots_show_more")}
        </Button>
      )}

      <ConfirmationModal
        visible={pendingDelete !== null}
        title={tCapture("delete_confirm_title")}
        descriptionText={tCapture("delete_confirm_description")}
        cancelButtonLabel={tCapture("cancel")}
        confirmButtonLabel={tCapture("delete_confirm_button")}
        confirmButtonTheme="danger"
        onConfirm={handleConfirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
