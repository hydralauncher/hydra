import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SyncIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useFocusTrap } from "@renderer/hooks/use-focus-trap";
import { toLocalScreenshotUrl } from "@shared";
import type { LocalScreenshot } from "@types";

import "./settings-screenshots-viewer.scss";

export interface SettingsScreenshotsViewerProps {
  screenshot: LocalScreenshot | null;
  index: number;
  count: number;
  title: string;
  statusLabel: string;
  hasPrevious: boolean;
  hasNext: boolean;
  uploadAction: { label: string; isRetry: boolean; disabled: boolean } | null;
  isBlocked: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onUpload: (screenshot: LocalScreenshot) => void;
  onDelete: (screenshot: LocalScreenshot) => void;
}

export function SettingsScreenshotsViewer({
  screenshot,
  index,
  count,
  title,
  statusLabel,
  hasPrevious,
  hasNext,
  uploadAction,
  isBlocked,
  onPrevious,
  onNext,
  onClose,
  onUpload,
  onDelete,
}: Readonly<SettingsScreenshotsViewerProps>) {
  const { t } = useTranslation(["settings", "modal", "game_details"]);
  const { t: tCapture } = useTranslation("screenshots_capture");
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useFocusTrap(dialogRef, screenshot !== null, isBlocked);

  useEffect(() => {
    if (!screenshot || isBlocked) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && hasPrevious) onPrevious();
      else if (event.key === "ArrowRight" && hasNext) onNext();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    hasNext,
    hasPrevious,
    isBlocked,
    onClose,
    onNext,
    onPrevious,
    screenshot,
  ]);

  if (!screenshot) return null;

  const capturedAt = new Date(screenshot.capturedAt).toLocaleString();

  return createPortal(
    <div className="settings-screenshots-viewer">
      <button
        type="button"
        className="settings-screenshots-viewer__backdrop"
        onClick={onClose}
        aria-label={t("close", { ns: "modal" })}
      />

      <dialog
        ref={dialogRef}
        className="settings-screenshots-viewer__dialog"
        tabIndex={-1}
        open
        aria-label={title}
      >
        <header className="settings-screenshots-viewer__header">
          <div className="settings-screenshots-viewer__info">
            <span className="settings-screenshots-viewer__title" title={title}>
              {title}
            </span>
            <span className="settings-screenshots-viewer__meta">
              {capturedAt}
              <span className="settings-screenshots-viewer__separator">
                {"·"}
              </span>
              {statusLabel}
              <span className="settings-screenshots-viewer__separator">
                {"·"}
              </span>
              {tCapture("thumbnail_label", { index: index + 1, count })}
            </span>
          </div>

          <div className="settings-screenshots-viewer__actions">
            {uploadAction && (
              <Button
                className="settings-screenshots-viewer__action"
                theme="outline"
                disabled={uploadAction.disabled}
                tooltip={uploadAction.label}
                tooltipPlace="bottom"
                aria-label={uploadAction.label}
                onClick={() => onUpload(screenshot)}
              >
                {uploadAction.isRetry ? (
                  <SyncIcon size={16} />
                ) : (
                  <UploadIcon size={16} />
                )}
              </Button>
            )}
            <Button
              className="settings-screenshots-viewer__action settings-screenshots-viewer__action--danger"
              theme="outline"
              tooltip={t("screenshots_delete_tooltip", { ns: "settings" })}
              tooltipPlace="bottom"
              aria-label={t("screenshots_delete_tooltip", { ns: "settings" })}
              onClick={() => onDelete(screenshot)}
            >
              <TrashIcon size={16} />
            </Button>
            <Button
              className="settings-screenshots-viewer__action"
              theme="outline"
              tooltip={t("close", { ns: "modal" })}
              tooltipPlace="bottom"
              aria-label={t("close", { ns: "modal" })}
              onClick={onClose}
            >
              <XIcon size={16} />
            </Button>
          </div>
        </header>

        <div className="settings-screenshots-viewer__stage">
          <button
            type="button"
            className="settings-screenshots-viewer__nav settings-screenshots-viewer__nav--previous"
            disabled={!hasPrevious}
            onClick={onPrevious}
            aria-label={t("previous_media", { ns: "game_details" })}
          >
            <ChevronLeftIcon size={28} />
          </button>

          <img
            key={screenshot.clientId}
            className="settings-screenshots-viewer__image"
            src={toLocalScreenshotUrl(screenshot.path)}
            alt={tCapture("screenshot_alt", {
              game: title,
              date: capturedAt,
            })}
            draggable={false}
          />

          <button
            type="button"
            className="settings-screenshots-viewer__nav settings-screenshots-viewer__nav--next"
            disabled={!hasNext}
            onClick={onNext}
            aria-label={t("next_media", { ns: "game_details" })}
          >
            <ChevronRightIcon size={28} />
          </button>
        </div>
      </dialog>
    </div>,
    document.body
  );
}
